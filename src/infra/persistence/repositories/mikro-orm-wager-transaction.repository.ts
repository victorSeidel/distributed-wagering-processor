import type { EntityManager } from "@mikro-orm/postgresql";

import type { WagerTransaction } from "../../../domain/wager/wager-transaction";
import { WagerTransactionKind, WagerTransactionStatus } from "../../../domain/wager/wager-transaction.types";

import type { WagerTransactionRepository } from "../../../application/ports/repositories.port";

import { WagerTransactionEntity } from "../entities/wager-transaction.entity";
import { TrackedEntities } from "./tracked-entities";

import { WagerTransactionMapper } from "../mappers/wager-transaction.mapper";

export class MikroOrmWagerTransactionRepository implements WagerTransactionRepository
{
    private readonly tracked = new TrackedEntities<WagerTransactionEntity>();

    constructor(private readonly em: EntityManager) {}

    public async findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | undefined>
    {
        return this.load(await this.em.findOne(WagerTransactionEntity, { idempotencyKey }));
    }

    public async findByProviderAndExternalId(providerId: string, externalTransactionId: string): Promise<WagerTransaction | undefined>
    {
        return this.load(await this.em.findOne(WagerTransactionEntity, { providerId, externalTransactionId }));
    }

    public async hasProcessedReversal(referenceTransactionId: string, kind: WagerTransactionKind): Promise<boolean>
    {
        return (await this.em.count(WagerTransactionEntity, { referenceTransactionId, kind, status: WagerTransactionStatus.Processed })) > 0;
    }

    public async claimNextPendingReference(now: Date): Promise<WagerTransaction | undefined>
    {
        const rows = await this.em.execute<{ id: string }[]>(
            `SELECT id FROM wager_transactions
             WHERE status = ? AND (reference_next_attempt_at IS NULL OR reference_next_attempt_at <= ?)
             ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
            [WagerTransactionStatus.PendingReference, now],
        );

        const id = rows[0]?.id;
        if (!id) return undefined;

        return this.load(await this.em.findOneOrFail(WagerTransactionEntity, { id }));
    }

    public add(transaction: WagerTransaction): void
    {
        const entity = this.tracked.track(transaction.id, WagerTransactionMapper.toEntity(transaction));
        this.em.persist(entity);
    }

    public save(transaction: WagerTransaction): void
    {
        WagerTransactionMapper.apply(this.tracked.require(transaction.id), transaction);
    }

    private load(entity: WagerTransactionEntity | null): WagerTransaction | undefined
    {
        return entity ? WagerTransactionMapper.toDomain(this.tracked.track(entity.id, entity)) : undefined;
    }
}