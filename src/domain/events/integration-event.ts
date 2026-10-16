import { v7 as uuidv7 } from "uuid";

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

export interface IntegrationEventEnvelope<T>
{
    eventId: string;
    eventType: string;
    aggregateId: string;
    correlationId: string;
    causationId?: string;
    occurredAt: string;
    version: number;
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

    public toJSON(): IntegrationEventEnvelope<T>
    {
        return {
            eventId: this.eventId,
            eventType: this.eventType,
            aggregateId: this.aggregateId,
            correlationId: this.correlationId,
            causationId: this.causationId,
            occurredAt: this.occurredAt.toISOString(),
            version: this.version,
            data: this.data,
        };
    }
}