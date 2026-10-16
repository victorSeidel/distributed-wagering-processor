import type { OutboxMessage } from "../../domain/messaging/outbox-message";

export abstract class IntegrationEventPublisher
{
    abstract publish(message: OutboxMessage): Promise<void>;
}