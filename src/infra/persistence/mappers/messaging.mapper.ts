import { InboxMessage } from "../../../domain/messaging/inbox-message";
import { OutboxMessage } from "../../../domain/messaging/outbox-message";
import { InboxMessageEntity, OutboxMessageEntity } from "../entities/messaging.entity";

export class MessagingMapper
{
    public static inboxToDomain(entity: InboxMessageEntity): InboxMessage
    {
        return InboxMessage.rehydrate({
            messageId: entity.messageId,
            consumerName: entity.consumerName,
            payloadHash: entity.payloadHash,
            receivedAt: entity.receivedAt,
            processedAt: entity.processedAt ?? undefined,
        });
    }

    public static inboxToEntity(domain: InboxMessage): InboxMessageEntity
    {
        const entity = new InboxMessageEntity();
        entity.consumerName = domain.consumerName;
        entity.messageId = domain.messageId;
        entity.payloadHash = domain.payloadHash;
        entity.receivedAt = domain.receivedAt;
        entity.processedAt = domain.processedAt ?? null;
        return entity;
    }

    public static applyInbox(entity: InboxMessageEntity, domain: InboxMessage): void
    {
        entity.processedAt = domain.processedAt ?? null;
    }

    public static outboxToDomain(entity: OutboxMessageEntity): OutboxMessage
    {
        return OutboxMessage.rehydrate({
            id: entity.id,
            aggregateId: entity.aggregateId,
            eventType: entity.eventType,
            payload: entity.payload,
            occurredAt: entity.occurredAt,
            attempts: entity.attempts,
            nextAttemptAt: entity.nextAttemptAt,
            publishedAt: entity.publishedAt ?? undefined,
        });
    }

    public static outboxToEntity(domain: OutboxMessage): OutboxMessageEntity
    {
        const entity = new OutboxMessageEntity();
        entity.id = domain.id;
        entity.aggregateId = domain.aggregateId;
        entity.eventType = domain.eventType;
        entity.payload = { ...domain.payload };
        entity.occurredAt = domain.occurredAt;
        MessagingMapper.applyOutbox(entity, domain);
        return entity;
    }

    public static applyOutbox(entity: OutboxMessageEntity, domain: OutboxMessage): void
    {
        entity.attempts = domain.attempts;
        entity.nextAttemptAt = domain.nextAttemptAt ?? domain.occurredAt;
        entity.publishedAt = domain.publishedAt ?? null;
    }
}