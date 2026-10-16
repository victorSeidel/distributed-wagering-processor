import type { WagerFailureCode, WagerTransactionKind, WagerTransactionStatus } from "../../domain/wager/wager-transaction.types";

export type Channel = "http" | "sqs";

export interface LogFields
{
    correlationId?: string;
    messageId?: string;
    transactionId?: string;
    walletId?: string;
    providerId?: string;
    [key: string]: unknown;
}

export abstract class AppLogger
{
    abstract info(message: string, fields?: LogFields): void;
    abstract warn(message: string, fields?: LogFields): void;
    abstract error(message: string, fields?: LogFields, error?: unknown): void;
}

export type RetryComponent = "pending_reference" | "outbox_publish" | "sqs_consumer";

export type LockResource = "wallet" | "advisory" | "deadlock";

export abstract class Metrics
{
    abstract transactionResolved(kind: WagerTransactionKind, status: WagerTransactionStatus, failureCode?: WagerFailureCode): void;
    abstract duplicateDetected(channel: Channel): void;
    abstract idempotencyConflict(): void;
    abstract retry(component: RetryComponent): void;
    abstract deadLettered(reason: string): void;
    abstract lockConflict(resource: LockResource): void;
    abstract outboxLagSeconds(seconds: number): void;
    abstract outboxPublished(): void;
    abstract processingDuration(channel: Channel, outcome: string, seconds: number): void;
    abstract reconciliationDivergence(): void;
}