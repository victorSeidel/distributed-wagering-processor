import { LockMode, type EntityManager } from "@mikro-orm/postgresql";

import type { Wallet } from "../../../domain/wallet/wallet";

import type { Metrics } from "../../../application/ports/observability.port";
import type { WalletRepository } from "../../../application/ports/repositories.port";

import { WalletEntity } from "../entities/wallet.entity";
import { TrackedEntities } from "./tracked-entities";

import { WalletMapper } from "../mappers/wallet.mapper";

const LOCK_CONTENTION_THRESHOLD_MS = 50;

export class MikroOrmWalletRepository implements WalletRepository
{
    private readonly tracked = new TrackedEntities<WalletEntity>();

    constructor(
        private readonly em: EntityManager,
        private readonly metrics: Metrics,
    ) {}

    public async findByIdForUpdate(walletId: string): Promise<Wallet | undefined>
    {
        const startedAt = performance.now();
        const entity = await this.em.findOne(WalletEntity, { id: walletId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
        if (performance.now() - startedAt > LOCK_CONTENTION_THRESHOLD_MS) this.metrics.lockConflict("wallet");

        return entity ? WalletMapper.toDomain(this.tracked.track(entity.id, entity)) : undefined;
    }

    public async findById(walletId: string): Promise<Wallet | undefined>
    {
        const entity = await this.em.findOne(WalletEntity, { id: walletId });
        return entity ? WalletMapper.toDomain(this.tracked.track(entity.id, entity)) : undefined;
    }

    public async existsForPlayer(playerId: string, currency: string): Promise<boolean>
    {
        return (await this.em.count(WalletEntity, { playerId, currency })) > 0;
    }

    public add(wallet: Wallet): void
    {
        const entity = this.tracked.track(wallet.id, WalletMapper.toEntity(wallet));
        this.em.persist(entity);
    }

    public save(wallet: Wallet): void
    {
        WalletMapper.apply(this.tracked.require(wallet.id), wallet);
    }
}