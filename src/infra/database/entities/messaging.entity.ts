import { defineEntity, p } from "@mikro-orm/core";

export const InboxMessageSchema = defineEntity({
    name: "InboxMessageEntity",
    tableName: "inbox_messages",
    properties: {
        consumerName: p.string().primary(),
        messageId: p.string().primary(),
        payloadHash: p.string().length(64),
        receivedAt: p.datetime().onCreate(() => new Date()),
        processedAt: p.datetime().nullable(),
    },
    uniques: [
        { name: "uk_inbox_messages_consumer_message", properties: ["consumerName", "messageId"] },
    ]
});

export class InboxMessageEntity extends InboxMessageSchema.class {}

InboxMessageSchema.setClass(InboxMessageEntity);

export const OutboxMessageSchema = defineEntity({
    name: "OutboxMessageEntity",
    tableName: "outbox_messages",
    properties: {
        id: p.uuid().primary(),
        aggregateId: p.string(),
        eventType: p.string(),
        payload: p.json<Record<string, unknown>>(),
        occurredAt: p.datetime(),
        attempts: p.integer().default(0),
        nextAttemptAt: p.datetime().onCreate(() => new Date()).index(),
        publishedAt: p.datetime().nullable().index(),
    },
    indexes: [
        { name: "idx_outbox_due", properties: ["publishedAt", "nextAttemptAt"] },
    ]
});

export class OutboxMessageEntity extends OutboxMessageSchema.class {}

OutboxMessageSchema.setClass(OutboxMessageEntity);