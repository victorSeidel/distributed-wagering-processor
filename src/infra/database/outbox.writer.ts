import type { EntityManager } from "@mikro-orm/postgresql";
import { v7 as uuidv7 } from "uuid";

import { OutboxMessageEntity } from "./entities/messaging.entity";

export interface OutboxEvent
{
    aggregateId: string;
    eventType: string;
    occurredAt: Date;
    toJSON: () => Record<string, unknown>;
}

export function enqueueOutbox(em: EntityManager, event: OutboxEvent): void
{
    const outbox = new OutboxMessageEntity();
    outbox.id = uuidv7();
    outbox.aggregateId = event.aggregateId;
    outbox.eventType = event.eventType;
    outbox.payload = event.toJSON();
    outbox.occurredAt = event.occurredAt;
    outbox.nextAttemptAt = new Date();
    outbox.attempts = 0;
    em.persist(outbox);
}
