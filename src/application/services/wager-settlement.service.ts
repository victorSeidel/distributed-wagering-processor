import { Injectable } from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";

import { WagerTransactionPendingReference, WagerTransactionProcessed, WagerTransactionRejected } from "../../domain/events/wager-transaction.events";
import { WalletBalanceChanged } from "../../domain/events/wallet-balance-changed.event";
import type { EventContext, IntegrationEvent } from "../../domain/events/integration-event";
import { OutboxMessage } from "../../domain/messaging/outbox-message";
import type { Money } from "../../domain/shared/money";
import type { WagerTransaction } from "../../domain/wager/wager-transaction";
import { WagerSettlement } from "../../domain/wager/wager-settlement";
import { WagerFailureCode, WagerTransactionStatus } from "../../domain/wager/wager-transaction.types";
import type { Wallet } from "../../domain/wallet/wallet";

import { Metrics } from "../ports/observability.port";
import type { TransactionScope } from "../ports/unit-of-work.port";

export interface SettlementOutcome
{
    transactionId: string;
    status: WagerTransactionStatus;
    balance: Money;
    failureCode?: WagerFailureCode;
}

export interface SettleParams
{
    wallet: Wallet;
    transaction: WagerTransaction;
    context: EventContext;
    persistence: "insert" | "update";
}

/**
 * Caso de uso compartilhado pelo fluxo HTTP/SQS e pelo worker de PENDING_REFERENCE.
 * Carrega a referência, delega a decisão ao domínio (WagerSettlement), persiste o resultado e enfileira os eventos na outbox.
 */
@Injectable()
export class WagerSettlementService
{
    constructor(
        private readonly metrics: Metrics
    ) {}

    public async settle(scope: TransactionScope, params: SettleParams): Promise<SettlementOutcome | undefined>
    {
        const { wallet, transaction, context } = params;

        const reference = transaction.requiresReference()
            ? await scope.transactions.findByProviderAndExternalId(transaction.providerId, transaction.referenceExternalTransactionId!)
            : undefined;

        const referenceAlreadyReversed = reference
            ? await scope.transactions.hasProcessedReversal(reference.id, transaction.kind)
            : false;

        const result = WagerSettlement.apply({
            wallet,
            transaction,
            reference,
            referenceAlreadyReversed,
            ledgerEntryId: uuidv7(),
            at: new Date(),
        });

        switch (result.type)
        {
            case "AWAITING_REFERENCE":
                return undefined;

            case "REJECTED":
                this.persist(scope, transaction, params.persistence);
                this.enqueue(scope, WagerTransactionRejected.from(transaction, wallet, context));
                break;

            case "PROCESSED":
                this.persist(scope, transaction, params.persistence);

                if (result.ledgerEntry)
                {
                    scope.wallets.save(wallet);
                    scope.ledger.add(result.ledgerEntry);
                    this.enqueue(scope, WalletBalanceChanged.from(wallet, result.ledgerEntry, context));
                }

                this.enqueue(scope, WagerTransactionProcessed.from(transaction, wallet, context));
                break;
        }

        this.metrics.transactionResolved(transaction.kind, transaction.status, transaction.failureCode);
        return this.outcome(transaction, wallet);
    }

    public registerPendingReference(scope: TransactionScope, wallet: Wallet, transaction: WagerTransaction, context: EventContext): SettlementOutcome
    {
        transaction.markPendingReference();
        transaction.recordBalanceAfter(wallet.balance);

        scope.transactions.add(transaction);
        this.enqueue(scope, WagerTransactionPendingReference.from(transaction, context));

        this.metrics.transactionResolved(transaction.kind, transaction.status);
        return this.outcome(transaction, wallet);
    }

    public rejectExpiredReference(scope: TransactionScope, wallet: Wallet, transaction: WagerTransaction, context: EventContext): SettlementOutcome
    {
        WagerSettlement.reject(wallet, transaction, WagerFailureCode.ReferenceNotFound, new Date());

        scope.transactions.save(transaction);
        this.enqueue(scope, WagerTransactionRejected.from(transaction, wallet, context));

        this.metrics.transactionResolved(transaction.kind, transaction.status, transaction.failureCode);
        return this.outcome(transaction, wallet);
    }

    private persist(scope: TransactionScope, transaction: WagerTransaction, mode: "insert" | "update"): void
    {
        if (mode === "insert") scope.transactions.add(transaction);
        else scope.transactions.save(transaction);
    }

    private enqueue(scope: TransactionScope, event: IntegrationEvent<unknown>): void
    {
        scope.outbox.enqueue(OutboxMessage.enqueue(event));
    }

    private outcome(transaction: WagerTransaction, wallet: Wallet): SettlementOutcome
    {
        return {
            transactionId: transaction.id,
            status: transaction.status,
            balance: wallet.balance,
            failureCode: transaction.failureCode,
        };
    }
}