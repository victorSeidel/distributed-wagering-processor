import type { EntityManager } from "@mikro-orm/postgresql";

import type { InboxMessage } from "../../../domain/messaging/inbox-message";
import type { OutboxMessage } from "../../../domain/messaging/outbox-message";
import type { WalletLedgerEntry } from "../../../domain/wallet/wallet-ledger-entry";

import type { Metrics } from "../../../application/ports/observability.port";
import type { InboxRepository, KeyLock, LedgerRepository, OutboxRepository } from "../../../application/ports/repositories.port";

import { InboxMessageEntity, OutboxMessageEntity } from "../entities/messaging.entity";
import { TrackedEntities } from "./tracked-entities";

import { MessagingMapper } from "../mappers/messaging.mapper";
import { WalletMapper } from "../mappers/wallet.mapper";

const LOCK_CONTENTION_THRESHOLD_MS = 50;

export class MikroOrmLedgerRepository implements LedgerRepository
{
    constructor(private readonly em: EntityManager) {}

    public add(entry: WalletLedgerEntry): void
    {
        this.em.persist(WalletMapper.ledgerToEntity(entry));
    }
}

export class MikroOrmInboxRepository implements InboxRepository
{
    private readonly tracked = new TrackedEntities<InboxMessageEntity>();

    constructor(private readonly em: EntityManager) {}

    public async findByKey(consumerName: string, messageId: string): Promise<InboxMessage | undefined>
    {
        const entity = await this.em.findOne(InboxMessageEntity, { consumerName, messageId });
        return entity ? MessagingMapper.inboxToDomain(this.tracked.track(this.key(consumerName, messageId), entity)) : undefined;
    }

    public add(message: InboxMessage): void
    {
        const entity = this.tracked.track(this.key(message.consumerName, message.messageId), MessagingMapper.inboxToEntity(message));
        this.em.persist(entity);
    }

    public save(message: InboxMessage): void
    {
        MessagingMapper.applyInbox(this.tracked.require(this.key(message.consumerName, message.messageId)), message);
    }

    private key(consumerName: string, messageId: string): string
    {
        return `${consumerName}:${messageId}`;
    }
}

export class MikroOrmOutboxRepository implements OutboxRepository
{
    private readonly tracked = new TrackedEntities<OutboxMessageEntity>();

    constructor(private readonly em: EntityManager) {}

    public enqueue(message: OutboxMessage): void
    {
        const entity = this.tracked.track(message.id, MessagingMapper.outboxToEntity(message));
        this.em.persist(entity);
    }

    public async claimDue(now: Date, limit: number): Promise<OutboxMessage[]>
    {
        const rows = await this.em.execute<{ id: string }[]>(
            `SELECT id FROM outbox_messages
             WHERE published_at IS NULL AND next_attempt_at <= ?
             ORDER BY occurred_at ASC LIMIT ? FOR UPDATE SKIP LOCKED`,
            [now, limit],
        );

        if (rows.length === 0) return [];

        const entities = await this.em.find(OutboxMessageEntity, { id: { $in: rows.map((row) => row.id) } }, { orderBy: { occurredAt: "ASC" } });
        return entities.map((entity) => MessagingMapper.outboxToDomain(this.tracked.track(entity.id, entity)));
    }

    public save(message: OutboxMessage): void
    {
        MessagingMapper.applyOutbox(this.tracked.require(message.id), message);
    }

    public async oldestPendingSince(): Promise<Date | undefined>
    {
        const rows = await this.em.execute<{ oldest: Date | null }[]>("SELECT MIN(occurred_at) AS oldest FROM outbox_messages WHERE published_at IS NULL");
        const oldest = rows[0]?.oldest;
        return oldest ? new Date(oldest) : undefined;
    }
}

export class MikroOrmKeyLock implements KeyLock
{
    constructor(
        private readonly em: EntityManager,
        private readonly metrics: Metrics,
    ) {}

    public async acquire(key: string): Promise<void>
    {
        const startedAt = performance.now();
        await this.em.execute("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", [key]);
        if (performance.now() - startedAt > LOCK_CONTENTION_THRESHOLD_MS) this.metrics.lockConflict("advisory");
    }
}