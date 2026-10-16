import type { MoneyProps } from "../shared/money";
import type { WagerTransaction } from "../wager/wager-transaction";
import type { WagerFailureCode, WagerTransactionKind } from "../wager/wager-transaction.types";
import type { Wallet } from "../wallet/wallet";
import { IntegrationEvent, type EventContext } from "./integration-event";

export interface WagerTransactionProcessedData
{
    transactionId: string;
    providerId: string;
    externalTransactionId: string;
    walletId: string;
    playerId: string;
    roundId: string;
    gameId: string;
    kind: WagerTransactionKind;
    money: MoneyProps;
    balanceAfter: MoneyProps;
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData>
{
    readonly eventType = "WagerTransactionProcessed";
    readonly version = 1;

    public static from(transaction: WagerTransaction, wallet: Wallet, context: EventContext): WagerTransactionProcessed
    {
        return new WagerTransactionProcessed({
            aggregateId: transaction.id,
            correlationId: context.correlationId,
            causationId: context.causationId,
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
    }
}

export interface WagerTransactionRejectedData
{
    transactionId: string;
    providerId: string;
    externalTransactionId: string;
    walletId: string;
    playerId: string;
    kind: WagerTransactionKind;
    failureCode: WagerFailureCode;
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData>
{
    readonly eventType = "WagerTransactionRejected";
    readonly version = 1;

    public static from(transaction: WagerTransaction, wallet: Wallet, context: EventContext): WagerTransactionRejected
    {
        return new WagerTransactionRejected({
            aggregateId: transaction.id,
            correlationId: context.correlationId,
            causationId: context.causationId,
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
    }
}

export interface WagerTransactionPendingReferenceData
{
    transactionId: string;
    providerId: string;
    externalTransactionId: string;
    referenceExternalTransactionId: string;
    walletId: string;
    playerId: string;
    kind: WagerTransactionKind;
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData>
{
    readonly eventType = "WagerTransactionPendingReference";
    readonly version = 1;

    public static from(transaction: WagerTransaction, context: EventContext): WagerTransactionPendingReference
    {
        return new WagerTransactionPendingReference({
            aggregateId: transaction.id,
            correlationId: context.correlationId,
            causationId: context.causationId,
            data: {
                transactionId: transaction.id,
                providerId: transaction.providerId,
                externalTransactionId: transaction.externalTransactionId,
                referenceExternalTransactionId: transaction.referenceExternalTransactionId!,
                walletId: transaction.walletId,
                playerId: transaction.playerId,
                kind: transaction.kind,
            },
        });
    }
}