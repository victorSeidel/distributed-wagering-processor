import { Injectable } from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";

import { InboxMessage } from "../../domain/messaging/inbox-message";
import { hashPayload } from "../../domain/shared/canonical-json";
import { BusinessError, CurrencyMismatchError, PermanentError } from "../../domain/shared/errors";
import { Money } from "../../domain/shared/money";
import { WagerTransaction } from "../../domain/wager/wager-transaction";

import type { InboxContext, ProcessWagerCommand, ProcessWagerOptions, ProcessWagerResult } from "../dto/wager.dto";

import { DuplicateExternalTransactionError, IdempotencyConflictError, InboxPayloadMismatchError, UniqueViolationError, WalletNotFoundError } from "../errors";

import { AppLogger, Metrics } from "../ports/observability.port";
import { UniqueConstraints } from "../ports/repositories.port";
import { UnitOfWork, type TransactionScope } from "../ports/unit-of-work.port";

import { WagerSettlementService } from "../services/wager-settlement.service";

import { validateWagerSubmission } from "../validation/input-validation";

@Injectable()
export class ProcessWagerUseCase
{
    constructor(
        private readonly uow: UnitOfWork,
        private readonly settlement: WagerSettlementService,
        private readonly metrics: Metrics,
        private readonly logger: AppLogger,
    ) {}

    public async execute(command: ProcessWagerCommand, options: ProcessWagerOptions = { channel: "http" }): Promise<ProcessWagerResult>
    {
        const startedAt = performance.now();
        let outcome = "error";

        try
        {
            const money = validateWagerSubmission(command);
            const correlationId = command.correlationId ?? uuidv7();
            const payloadHash = this.hashBusinessPayload(command, money);

            const result = await this.uow.run((scope) => this.process(scope, command, money, payloadHash, correlationId, options));

            outcome = result.idempotentReplay ? "replay" : result.status.toLowerCase();
            this.logger.info("Transação processada", {
                correlationId,
                transactionId: result.transactionId,
                walletId: command.walletId,
                providerId: command.providerId,
                kind: command.kind,
                status: result.status,
                failureCode: result.failureCode,
                idempotentReplay: result.idempotentReplay,
                channel: options.channel,
            });

            return result;
        }
        catch (err)
        {
            outcome = err instanceof BusinessError ? "business_error" : err instanceof PermanentError ? "invalid" : "error";

            if (err instanceof UniqueViolationError && err.constraint === UniqueConstraints.WagerProviderExternalTransaction)
                throw new DuplicateExternalTransactionError(command.providerId, command.externalTransactionId);

            throw err;
        }
        finally
        {
            this.metrics.processingDuration(options.channel, outcome, (performance.now() - startedAt) / 1000);
        }
    }

    private async process(
        scope: TransactionScope,
        command: ProcessWagerCommand,
        money: Money,
        payloadHash: string,
        correlationId: string,
        options: ProcessWagerOptions,
    ): Promise<ProcessWagerResult>
    {
        const inbox = options.inbox ? await this.acquireInbox(scope, options.inbox) : undefined;

        await scope.locks.acquire(command.idempotencyKey);

        const existing = await scope.transactions.findByIdempotencyKey(command.idempotencyKey);
        if (existing)
        {
            if (!existing.matchesPayload(payloadHash))
            {
                this.metrics.idempotencyConflict();
                throw new IdempotencyConflictError(command.idempotencyKey);
            }

            this.metrics.duplicateDetected(options.channel);
            inbox?.markProcessed(new Date());
            if (inbox) scope.inbox.save(inbox);

            return this.replay(scope, existing);
        }

        const wallet = await scope.wallets.findByIdForUpdate(command.walletId);
        if (!wallet) throw new WalletNotFoundError(command.walletId);
        if (wallet.currency !== money.currency) throw new CurrencyMismatchError(money.currency, wallet.currency);

        const transaction = WagerTransaction.create({
            id: uuidv7(),
            providerId: command.providerId,
            externalTransactionId: command.externalTransactionId,
            idempotencyKey: command.idempotencyKey,
            payloadHash,
            walletId: wallet.id,
            playerId: command.playerId,
            roundId: command.roundId,
            gameId: command.gameId,
            kind: command.kind,
            money,
            referenceExternalTransactionId: command.referenceExternalTransactionId,
        });

        const context = { correlationId, causationId: options.inbox?.messageId ?? command.idempotencyKey };
        const outcome = (await this.settlement.settle(scope, { wallet, transaction, context, persistence: "insert" }))
            ?? this.settlement.registerPendingReference(scope, wallet, transaction, context);

        if (inbox)
        {
            inbox.markProcessed(new Date());
            scope.inbox.save(inbox);
        }

        return {
            transactionId: outcome.transactionId,
            status: outcome.status,
            balance: outcome.balance.toJSON(),
            idempotentReplay: false,
            failureCode: outcome.failureCode,
        };
    }

    private async replay(scope: TransactionScope, existing: WagerTransaction): Promise<ProcessWagerResult>
    {
        const balance = existing.balanceAfter ?? (await scope.wallets.findById(existing.walletId))?.balance ?? existing.money;

        return {
            transactionId: existing.id,
            status: existing.status,
            balance: balance.toJSON(),
            idempotentReplay: true,
            failureCode: existing.failureCode,
        };
    }

    private async acquireInbox(scope: TransactionScope, context: InboxContext): Promise<InboxMessage>
    {
        await scope.locks.acquire(`inbox:${context.consumerName}:${context.messageId}`);

        const existing = await scope.inbox.findByKey(context.consumerName, context.messageId);
        if (existing)
        {
            if (!existing.matchesPayload(context.payloadHash)) throw new InboxPayloadMismatchError(context.consumerName, context.messageId);
            return existing;
        }

        const message = InboxMessage.receive(context);
        scope.inbox.add(message);
        return message;
    }

    private hashBusinessPayload(command: ProcessWagerCommand, money: Money): string
    {
        return hashPayload({
            providerId: command.providerId,
            externalTransactionId: command.externalTransactionId,
            playerId: command.playerId,
            walletId: command.walletId,
            roundId: command.roundId,
            gameId: command.gameId,
            kind: command.kind,
            money: money.toJSON(),
            referenceExternalTransactionId: command.referenceExternalTransactionId ?? null,
        });
    }
}