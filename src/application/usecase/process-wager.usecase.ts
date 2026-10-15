import { Injectable } from "@nestjs/common";
import { EntityManager, LockMode } from "@mikro-orm/postgresql";
import { UniqueConstraintViolationException } from "@mikro-orm/core";
import { v7 as uuidv7 } from "uuid";

import { Money } from "../../domain/common/money";
import { hashPayload } from "../../domain/common/canonical-json";
import { IdempotencyConflictError, DuplicateExternalTransactionError, WalletNotFoundError, CurrencyMismatchError, InboxPayloadMismatchError } from "../../domain/common/errors";
import { WagerTransaction } from "../../domain/wager/wager-transaction";

import type { Money as MoneyType } from "../../model/type/money.type";
import type { WagerFailureCode, WagerTransactionKind, WagerTransactionStatus } from "../../model/entity/wager.entity";

import { WagerTransactionEntity } from "../../infra/database/entities/wager-transaction.entity";
import { WalletEntity } from "../../infra/database/entities/wallet.entity";
import { InboxMessageEntity } from "../../infra/database/entities/messaging.entity";
import { DatabaseMapper } from "../../infra/database/database.mapper";

import { WagerSettlementService } from "../service/wager-settlement.service";
import { validateWagerSubmission } from "../validation/wager-input.validation";

export interface ProcessWagerInput
{
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    playerId: string;
    walletId: string;
    roundId: string;
    gameId: string;
    kind: WagerTransactionKind;
    money: MoneyType;
    referenceExternalTransactionId?: string;
    correlationId?: string;
}

export interface ProcessWagerOutput
{
    transactionId: string;
    status: WagerTransactionStatus;
    balance: MoneyType;
    idempotentReplay: boolean;
    failureCode?: WagerFailureCode;
}

export interface InboxContext
{
    consumerName: string;
    messageId: string;
    payloadHash: string;
}

@Injectable()
export class ProcessWagerUseCase
{
    constructor(
        private readonly em: EntityManager,
        private readonly settlement: WagerSettlementService,
    ) {}

    public async execute(input: ProcessWagerInput, inbox?: InboxContext): Promise<ProcessWagerOutput>
    {
        const inputMoney = validateWagerSubmission(input);
        const correlationId = input.correlationId ?? uuidv7();

        const currentPayloadHash = hashPayload({
            providerId: input.providerId,
            externalTransactionId: input.externalTransactionId,
            playerId: input.playerId,
            walletId: input.walletId,
            roundId: input.roundId,
            gameId: input.gameId,
            kind: input.kind,
            money: inputMoney.toJSON(),
            referenceExternalTransactionId: input.referenceExternalTransactionId ?? null,
        });

        try
        {
            return await this.em.transactional(async (em) =>
            {
                const inboxEntry = inbox ? await this.acquireInbox(em, inbox) : undefined;
                const output = await this.processInTransaction(em, input, inputMoney, correlationId, currentPayloadHash);
                if (inboxEntry && !inboxEntry.processedAt) inboxEntry.processedAt = new Date();
                return output;
            });
        }
        catch (err)
        {
            if (err instanceof UniqueConstraintViolationException && err.message.includes("uq_wagers_provider_external_tx"))
                throw new DuplicateExternalTransactionError(input.providerId, input.externalTransactionId);

            throw err;
        }
    }

    private async acquireInbox(em: EntityManager, inbox: InboxContext): Promise<InboxMessageEntity>
    {
        await em.execute("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", [`inbox:${inbox.consumerName}:${inbox.messageId}`]);

        const existing = await em.findOne(InboxMessageEntity, { consumerName: inbox.consumerName, messageId: inbox.messageId });

        if (existing)
        {
            if (existing.payloadHash !== inbox.payloadHash) throw new InboxPayloadMismatchError(inbox.consumerName, inbox.messageId);
            return existing;
        }

        const entry = new InboxMessageEntity();
        entry.consumerName = inbox.consumerName;
        entry.messageId = inbox.messageId;
        entry.payloadHash = inbox.payloadHash;
        entry.receivedAt = new Date();
        em.persist(entry);

        return entry;
    }

    private async processInTransaction(
        em: EntityManager,
        input: ProcessWagerInput,
        inputMoney: Money,
        correlationId: string,
        currentPayloadHash: string):
    Promise<ProcessWagerOutput>
    {
        const idempotencyKey = input.idempotencyKey;
        await em.execute("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", [idempotencyKey]);

        const existingTxEntity = await em.findOne(WagerTransactionEntity, { idempotencyKey });
        if (existingTxEntity)
        {
            const existingTx = DatabaseMapper.toWagerDomain(existingTxEntity);
            if (!existingTx.matchesPayload(currentPayloadHash)) throw new IdempotencyConflictError(idempotencyKey);

            const balance = existingTxEntity.balanceAfter
                ? Money.from({ amount: existingTxEntity.balanceAfter, currency: existingTxEntity.currency }).toJSON()
                : await this.currentBalance(em, existingTx.walletId, input.money);

            return {
                transactionId: existingTx.id,
                status: existingTx.status,
                balance,
                idempotentReplay: true,
                failureCode: existingTx.failureCode,
            };
        }

        const walletEntity = await em.findOne(WalletEntity, { id: input.walletId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
        if (!walletEntity) throw new WalletNotFoundError(input.walletId);
        if (walletEntity.currency !== inputMoney.currency) throw new CurrencyMismatchError(inputMoney.currency, walletEntity.currency);

        const transaction = WagerTransaction.create({
            id: uuidv7(),
            providerId: input.providerId,
            externalTransactionId: input.externalTransactionId,
            idempotencyKey,
            payloadHash: currentPayloadHash,
            walletId: walletEntity.id,
            playerId: input.playerId,
            roundId: input.roundId,
            gameId: input.gameId,
            kind: input.kind,
            money: inputMoney,
            referenceExternalTransactionId: input.referenceExternalTransactionId,
        });

        const params = { walletEntity, transaction, correlationId };
        const outcome = (await this.settlement.settle(em, params)) ?? this.settlement.registerPendingReference(em, params);

        await em.flush();

        return {
            transactionId: outcome.transactionId,
            status: outcome.status,
            balance: outcome.balance.toJSON(),
            idempotentReplay: false,
            failureCode: outcome.failureCode,
        };
    }

    private async currentBalance(em: EntityManager, walletId: string, fallback: MoneyType): Promise<MoneyType>
    {
        const walletEntity = await em.findOne(WalletEntity, { id: walletId });
        return walletEntity ? Money.from({ amount: walletEntity.balance, currency: walletEntity.currency }).toJSON() : fallback;
    }
}
