import { Injectable } from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";

import { Metrics, AppLogger } from "../ports/observability.port";
import { UnitOfWork } from "../ports/unit-of-work.port";

import { ReferenceRetryPolicy } from "../services/reference-retry.policy";
import { WagerSettlementService } from "../services/wager-settlement.service";

@Injectable()
export class ProcessPendingReferencesUseCase
{
    constructor(
        private readonly uow: UnitOfWork,
        private readonly settlement: WagerSettlementService,
        private readonly policy: ReferenceRetryPolicy,
        private readonly metrics: Metrics,
        private readonly logger: AppLogger,
    ) {}

    public async execute(): Promise<boolean>
    {
        return await this.uow.run(async (scope) =>
        {
            const now = new Date();

            const transaction = await scope.transactions.claimNextPendingReference(now);
            if (!transaction) return false;

            const wallet = await scope.wallets.findByIdForUpdate(transaction.walletId);
            if (!wallet) throw new Error(`Wallet ${transaction.walletId} da transação ${transaction.id} não encontrada`);

            const context = { correlationId: uuidv7(), causationId: transaction.id };
            const fields = { correlationId: context.correlationId, transactionId: transaction.id, walletId: transaction.walletId, providerId: transaction.providerId };

            const outcome = await this.settlement.settle(scope, { wallet, transaction, context, persistence: "update" });
            if (outcome)
            {
                this.logger.info("Transação pendente reprocessada", { ...fields, status: outcome.status, failureCode: outcome.failureCode });
                return true;
            }

            const exhausted = this.policy.isExhausted(transaction, now);
            const attemptNumber = transaction.referenceAttempts + 1;
            transaction.recordReferenceMiss(exhausted ? undefined : new Date(now.getTime() + this.policy.nextDelayMs(attemptNumber)));

            if (exhausted)
            {
                this.settlement.rejectExpiredReference(scope, wallet, transaction, context);
                this.logger.warn("Referência não encontrada; transação rejeitada", { ...fields, attempts: transaction.referenceAttempts });
            }
            else
            {
                scope.transactions.save(transaction);
                this.metrics.retry("pending_reference");
            }

            return true;
        });
    }
}