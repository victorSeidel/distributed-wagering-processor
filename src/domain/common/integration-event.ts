import { v7 as uuidv7 } from "uuid";
import type { LedgerDirection } from "../../model/type/wallet.type";
import type { Money } from "../../model/type/money.type";
import type { WagerFailureCode, WagerTransactionKind } from "../../model/entity/wager.entity";

export interface EventContext
{
    correlationId: string;
    causationId?: string;
}

export interface IntegrationEventProps<T>
{
    eventId?: string;
    aggregateId: string;
    correlationId: string;
    causationId?: string;
    occurredAt?: Date;
    data: T;
}

export abstract class IntegrationEvent<T>
{
    abstract readonly eventType: string;
    abstract readonly version: number;

    public readonly eventId: string;
    public readonly aggregateId: string;
    public readonly correlationId: string;
    public readonly causationId?: string;
    public readonly occurredAt: Date;
    public readonly data: Readonly<T>;

    protected constructor(props: IntegrationEventProps<T>)
    {
        this.eventId = props.eventId ?? uuidv7();
        this.aggregateId = props.aggregateId;
        this.correlationId = props.correlationId;
        this.causationId = props.causationId;
        this.occurredAt = props.occurredAt ?? new Date();
        this.data = props.data;
    }

    public toJSON()
    {
        return {
            eventId: this.eventId,
            eventType: this.eventType,
            version: this.version,
            aggregateId: this.aggregateId,
            correlationId: this.correlationId,
            causationId: this.causationId,
            occurredAt: this.occurredAt.toISOString(),
            data: this.data,
        };
    }
}

export interface WalletBalanceChangedData
{
    walletId: string;
    transactionId: string;
    direction: LedgerDirection;
    money: Money;
    balanceBefore: Money;
    balanceAfter: Money;
    walletVersion: number;
}

export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData>
{
    readonly eventType = "WalletBalanceChanged";
    readonly version = 1;

    public constructor(props: IntegrationEventProps<WalletBalanceChangedData>)
    {
        super(props);
    }
}

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
    money: Money;
    balanceAfter: Money;
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData>
{
    readonly eventType = "WagerTransactionProcessed";
    readonly version = 1;

    public constructor(props: IntegrationEventProps<WagerTransactionProcessedData>)
    {
        super(props);
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

    public constructor(props: IntegrationEventProps<WagerTransactionRejectedData>)
    {
        super(props);
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

    public constructor(props: IntegrationEventProps<WagerTransactionPendingReferenceData>)
    {
        super(props);
    }
}