import { Injectable, ConflictException, NotFoundException } from "@nestjs/common";
import { EntityManager, LockMode } from "@mikro-orm/postgresql";
import { v7 as uuidv7 } from "uuid";

import { Money } from "../../domain/common/money";
import { WalletBalanceChanged, WagerTransactionProcessed, WagerTransactionRejected, WagerTransactionPendingReference, } from "../../domain/common/integration-event";
import { hashPayload } from "../../domain/common/canonical-json";
import { InboxPayloadMismatchError } from "../../domain/exception/inbox-payload-mismatch-error";
import { WagerTransaction } from "../../domain/wager/wager-transaction";
import { WalletLedgerEntry } from "../../domain/wallet/wallet-ledger-entry";
import type { Wallet } from "../../domain/wallet/wallet";

import type { Money as MoneyType } from "../../model/type/money.type";
import { WagerFailureCode, WagerTransactionKind, WagerTransactionStatus } from "../../model/entity/wager.entity";
import { LedgerDirection } from "../../model/type/wallet.type";

import { WagerTransactionEntity } from "../../infra/database/entities/wager-transaction.entity";
import { WalletEntity } from "../../infra/database/entities/wallet.entity";
import { InboxMessageEntity, OutboxMessageEntity } from "../../infra/database/entities/messaging.entity";
import { DatabaseMapper } from "../../infra/database/database.mapper";

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
    constructor(private readonly em: EntityManager) {}

    public async execute(input: ProcessWagerInput, inbox?: InboxContext): Promise<ProcessWagerOutput>
    {
        const inputMoney = Money.from(input.money);
        const correlationId = input.correlationId ?? uuidv7();

        const businessPayload = {
            providerId: input.providerId,
            externalTransactionId: input.externalTransactionId,
            playerId: input.playerId,
            walletId: input.walletId,
            roundId: input.roundId,
            gameId: input.gameId,
            kind: input.kind,
            money: input.money,
            referenceExternalTransactionId: input.referenceExternalTransactionId ?? null,
        };

        const currentPayloadHash = hashPayload(businessPayload);

        return await this.em.transactional(async (em) =>
        {
            const inboxEntry = inbox ? await this.acquireInbox(em, inbox) : undefined;
            const output = await this.processInTransaction(em, input, inputMoney, correlationId, currentPayloadHash);
            if (inboxEntry && !inboxEntry.processedAt) inboxEntry.processedAt = new Date();
            return output;
        });
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

        const existingTxEntity = await em.findOne(WagerTransactionEntity, { idempotencyKey: idempotencyKey });
        if (existingTxEntity)
        {
            const existingTx = DatabaseMapper.toWagerDomain(existingTxEntity);
            if (!existingTx.matchesPayload(currentPayloadHash)) throw new ConflictException(`A chave '${idempotencyKey}' já foi utilizada com outro payload`);

            const walletEntity = await em.findOne(WalletEntity, { id: existingTx.walletId });
            const currentBalance = walletEntity ? Money.from({ amount: walletEntity.balance, currency: walletEntity.currency }).toJSON() : input.money;

            return {
                transactionId: existingTx.id,
                status: existingTx.status,
                balance: currentBalance,
                idempotentReplay: true,
                failureCode: existingTx.failureCode,
            };
        }

        const walletEntity = await em.findOne(WalletEntity, { id: input.walletId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
        if (!walletEntity) throw new NotFoundException(`Wallet '${input.walletId}' não encontrada`);

        const wallet = DatabaseMapper.toWalletDomain(walletEntity);
        if (wallet.currency !== inputMoney.currency) throw new ConflictException(`Moeda (${inputMoney.currency}) não corresponde à carteira (${wallet.currency})`);

        const transactionId = uuidv7();
        const transaction = WagerTransaction.create({
            id: transactionId,
            providerId: input.providerId,
            externalTransactionId: input.externalTransactionId,
            idempotencyKey: idempotencyKey,
            payloadHash: currentPayloadHash,
            walletId: wallet.id,
            playerId: input.playerId,
            roundId: input.roundId,
            gameId: input.gameId,
            kind: input.kind,
            money: inputMoney,
            referenceExternalTransactionId: input.referenceExternalTransactionId,
        });

        let referenceTx: WagerTransaction | undefined;

        if (transaction.requiresReference())
        {
            const refEntity = await em.findOne(WagerTransactionEntity, {
                providerId: input.providerId,
                externalTransactionId: input.referenceExternalTransactionId,
            });

            if (!refEntity)
            {
                transaction.markPendingReference();
                em.persist(DatabaseMapper.toWagerEntity(transaction));

                const pendingEvent = new WagerTransactionPendingReference({
                    aggregateId: transaction.id,
                    correlationId,
                    data: {
                        transactionId: transaction.id,
                        providerId: transaction.providerId,
                        externalTransactionId: transaction.externalTransactionId,
                        referenceExternalTransactionId: input.referenceExternalTransactionId!,
                        walletId: wallet.id,
                        playerId: wallet.playerId,
                        kind: transaction.kind,
                    },
                });

                this.enqueueOutbox(em, pendingEvent);

                await em.flush();

                return {
                    transactionId: transaction.id,
                    status: transaction.status,
                    balance: wallet.balance.toJSON(),
                    idempotentReplay: false,
                };
            }

            referenceTx = DatabaseMapper.toWagerDomain(refEntity);

            if (referenceTx.playerId !== input.playerId || referenceTx.walletId !== input.walletId ||
                referenceTx.roundId !== input.roundId || !referenceTx.money.equals(inputMoney))
            {
                transaction.reject(WagerFailureCode.AmountMismatch);
                return this.persistRejection(em, wallet, transaction, correlationId);
            }

            if (input.kind === WagerTransactionKind.Refund && referenceTx.kind !== WagerTransactionKind.Bet)
            {
                transaction.reject(WagerFailureCode.InvalidReferenceType);
                return this.persistRejection(em, wallet, transaction, correlationId);
            }

            const alreadyReversed = await em.findOne(WagerTransactionEntity, {
                referenceTransactionId: referenceTx.id,
                kind: input.kind,
                status: WagerTransactionStatus.Processed,
            });

            if (alreadyReversed)
            {
                transaction.reject(WagerFailureCode.ReferenceAlreadyReversed);
                return this.persistRejection(em, wallet, transaction, correlationId);
            }
        }

        const balanceBefore = wallet.balance;

        switch (input.kind)
        {
            case WagerTransactionKind.Bet:
            {
                if (wallet.balance.isLessThan(inputMoney))
                {
                    transaction.reject(WagerFailureCode.InsufficientFunds);
                    return this.persistRejection(em, wallet, transaction, correlationId);
                }

                wallet.debit(inputMoney);
                break;
            }

            case WagerTransactionKind.Win:
            {
                wallet.credit(inputMoney);
                break;
            }

            case WagerTransactionKind.Loss:
            {
                // LOSS não move saldo nem cria ledger
                break;
            }

            case WagerTransactionKind.Refund:
            {
                wallet.credit(inputMoney);
                break;
            }

            case WagerTransactionKind.Rollback:
            {
                const dir = transaction.ledgerDirectionFor(referenceTx);
                if (dir === LedgerDirection.Debit)
                {
                    if (wallet.balance.isLessThan(inputMoney))
                    {
                        transaction.reject(WagerFailureCode.ReversalWouldProduceNegativeBalance);
                        return this.persistRejection(em, wallet, transaction, correlationId);
                    }

                    wallet.debit(inputMoney);
                }
                else
                {
                    wallet.credit(inputMoney);
                }

                break;
            }
        }

        transaction.markProcessed(referenceTx?.id, new Date());
        em.persist(DatabaseMapper.toWagerEntity(transaction));

        if (transaction.affectsBalance())
        {
            const balanceAfter = wallet.balance;
            const direction = transaction.ledgerDirectionFor(referenceTx);

            const ledgerEntry = WalletLedgerEntry.create({
                id: uuidv7(),
                walletId: wallet.id,
                transactionId: transaction.id,
                direction,
                money: inputMoney,
                balanceBefore,
                balanceAfter,
            });

            walletEntity.balance = wallet.balance.toString();
            walletEntity.version = wallet.version;
            walletEntity.updatedAt = wallet.updatedAt;

            em.persist(DatabaseMapper.toLedgerEntity(ledgerEntry));

            const balanceEvent = new WalletBalanceChanged({
                aggregateId: wallet.id,
                correlationId,
                data: {
                    walletId: wallet.id,
                    transactionId: transaction.id,
                    direction,
                    money: inputMoney.toJSON(),
                    balanceBefore: balanceBefore.toJSON(),
                    balanceAfter: balanceAfter.toJSON(),
                    walletVersion: wallet.version,
                },
            });

            this.enqueueOutbox(em, balanceEvent);
        }

        const processedEvent = new WagerTransactionProcessed({
            aggregateId: transaction.id,
            correlationId,
            data: {
                transactionId: transaction.id,
                providerId: transaction.providerId,
                externalTransactionId: transaction.externalTransactionId,
                walletId: wallet.id,
                playerId: wallet.playerId,
                roundId: transaction.roundId,
                gameId: transaction.gameId,
                kind: transaction.kind,
                money: transaction.money.toJSON(),
                balanceAfter: wallet.balance.toJSON(),
            },
        });

        this.enqueueOutbox(em, processedEvent);

        await em.flush();

        return {
            transactionId: transaction.id,
            status: transaction.status,
            balance: wallet.balance.toJSON(),
            idempotentReplay: false,
        };
    }

    private async persistRejection(em: EntityManager, wallet: Wallet, transaction: WagerTransaction, correlationId: string): Promise<ProcessWagerOutput>
    {
        em.persist(DatabaseMapper.toWagerEntity(transaction));

        const rejectedEvent = new WagerTransactionRejected({
            aggregateId: transaction.id,
            correlationId,
            data: {
                transactionId: transaction.id,
                providerId: transaction.providerId,
                externalTransactionId: transaction.externalTransactionId,
                walletId: wallet.id,
                playerId: wallet.playerId,
                kind: transaction.kind,
                failureCode: transaction.failureCode!,
            },
        });

        this.enqueueOutbox(em, rejectedEvent);

        await em.flush();

        return {
            transactionId: transaction.id,
            status: transaction.status,
            balance: wallet.balance.toJSON(),
            idempotentReplay: false,
            failureCode: transaction.failureCode,
        };
    }

    private enqueueOutbox(em: EntityManager, event: { aggregateId: string; eventType: string; toJSON: () => Record<string, unknown> }): void
    {
        const outboxEntity = new OutboxMessageEntity();
        outboxEntity.id = uuidv7();
        outboxEntity.aggregateId = event.aggregateId;
        outboxEntity.eventType = event.eventType;
        outboxEntity.payload = event.toJSON();
        outboxEntity.occurredAt = new Date();
        outboxEntity.nextAttemptAt = new Date();
        outboxEntity.attempts = 0;
        em.persist(outboxEntity);
    }
}