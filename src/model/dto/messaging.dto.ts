export interface OutboxMessageState
{
    id: string;
    aggregateId: string;
    eventType: string;
    payload: Record<string, unknown>;
    occurredAt: Date;
    attempts: number;
    nextAttemptAt: Date;
    publishedAt?: Date;
}