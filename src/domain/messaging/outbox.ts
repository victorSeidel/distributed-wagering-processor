import type { OutboxMessageState } from "../../model/dto/messaging.dto";

export class OutboxMessage
{
    private constructor(
        public readonly id: string,
        public readonly aggregateId: string,
        public readonly eventType: string,
        public readonly payload: Readonly<Record<string, unknown>>,
        public readonly occurredAt: Date,
        private _attempts: number,
        private _nextAttemptAt: Date,
        private _publishedAt?: Date,
    ) {}

    public static enqueue(id: string, aggregateId: string, eventType: string, payload: Record<string, unknown>, occurredAt: Date = new Date()): OutboxMessage
    {
        return new OutboxMessage(id, aggregateId, eventType, payload, occurredAt, 0, occurredAt);
    }

    public static rehydrate(state: OutboxMessageState): OutboxMessage
    {
        return new OutboxMessage(
            state.id,
            state.aggregateId,
            state.eventType,
            state.payload,
            state.occurredAt,
            state.attempts,
            state.nextAttemptAt,
            state.publishedAt,
        );
    }

    public get attempts(): number { return this._attempts; }
    public get nextAttemptAt(): Date { return this._nextAttemptAt; }
    public get publishedAt(): Date | undefined { return this._publishedAt; }

    public isPending(): boolean { return this._publishedAt === undefined; }
    public isDue(now: Date): boolean { return this.isPending() && this._nextAttemptAt <= now; }
    public markPublished(at: Date): void { this._publishedAt = at; }

    public scheduleRetry(now: Date): void
    {
        this._attempts += 1;
        const backoffMs = Math.min(Math.pow(2, this._attempts) * 1000, 60000);
        this._nextAttemptAt = new Date(now.getTime() + backoffMs);
    }
}