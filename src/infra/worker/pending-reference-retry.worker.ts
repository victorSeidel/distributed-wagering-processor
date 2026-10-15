import { Injectable, type OnModuleInit, type OnModuleDestroy, Logger } from "@nestjs/common";
import { EntityManager, LockMode } from "@mikro-orm/postgresql";

import { v7 as uuidv7 } from "uuid";

import { WagerTransactionEntity } from "../database/entities/wager-transaction.entity";
import { WalletEntity } from "../database/entities/wallet.entity";
import { DatabaseMapper } from "../database/database.mapper";

import { WagerFailureCode, WagerTransactionStatus } from "../../model/entity/wager.entity";

import { WagerSettlementService } from "../../application/service/wager-settlement.service";


@Injectable()
export class PendingReferenceRetryWorker implements OnModuleInit, OnModuleDestroy
{
    private readonly logger = new Logger(PendingReferenceRetryWorker.name);
    private isRunning = false;
    private intervalRef: NodeJS.Timeout | null = null;
    private isProcessing = false;

    private readonly pollIntervalMs = 3000;
    private readonly batchSize = 20;
    private readonly ttlMs = 5 * 60 * 1000;
    private readonly maxAttempts = 10;
    private readonly backoffBaseMs = 2000;
    private readonly backoffMaxMs = 60_000;

    constructor(
        private readonly em: EntityManager,
        private readonly settlement: WagerSettlementService,
    ) {}

    onModuleInit()
    {
        this.isRunning = true;
        this.intervalRef = setInterval(() => void this.processPendingReferences(), this.pollIntervalMs);
        this.logger.log("PendingReferenceRetryWorker inicializado.");
    }

    async onModuleDestroy()
    {
        this.isRunning = false;
        if (this.intervalRef) clearInterval(this.intervalRef);
        while (this.isProcessing) await new Promise((resolve) => setTimeout(resolve, 50));
        this.logger.log("PendingReferenceRetryWorker finalizado.");
    }

    public async processPendingReferences(): Promise<void>
    {
        if (!this.isRunning || this.isProcessing) return;
        this.isProcessing = true;

        try
        {
            for (let i = 0; i < this.batchSize && this.isRunning; i++)
            {
                const handled = await this.processNext();
                if (!handled) break;
            }
        }
        catch (err: unknown)
        {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.logger.error(`Erro ao processar referências pendentes: ${errorMsg}`);
        }
        finally
        {
            this.isProcessing = false;
        }
    }

    private async processNext(): Promise<boolean>
    {
        return await this.em.fork().transactional(async (em) =>
        {
            const now = new Date();

            const rows = await em.execute<{ id: string }[]>(
                `SELECT id FROM wager_transactions
                WHERE status = ? AND (reference_next_attempt_at IS NULL OR reference_next_attempt_at <= ?)
                ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
                [WagerTransactionStatus.PendingReference, now],
            );

            const id = rows[0]?.id;
            if (!id) return false;

            const txEntity = await em.findOneOrFail(WagerTransactionEntity, { id });
            if (txEntity.status !== WagerTransactionStatus.PendingReference) return true;

            const walletEntity = await em.findOne(WalletEntity, { id: txEntity.walletId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
            if (!walletEntity) throw new Error(`Wallet ${txEntity.walletId} da transação ${txEntity.id} não encontrada`);

            const transaction = DatabaseMapper.toWagerDomain(txEntity);
            const params = { walletEntity, transaction, correlationId: uuidv7(), existingEntity: txEntity };

            const outcome = await this.settlement.settle(em, params);
            if (outcome)
            {
                this.logger.log(`transactionId=${txEntity.id} walletId=${txEntity.walletId} providerId=${txEntity.providerId} reprocessada status=${outcome.status}${outcome.failureCode ? ` failureCode=${outcome.failureCode}` : ""}`);
                return true;
            }

            const attempts = txEntity.referenceAttempts + 1;
            const expired = now.getTime() - txEntity.createdAt.getTime() > this.ttlMs || attempts >= this.maxAttempts;

            if (expired)
            {
                this.settlement.reject(em, params, DatabaseMapper.toWalletDomain(walletEntity), WagerFailureCode.ReferenceNotFound);
                txEntity.referenceAttempts = attempts;
                this.logger.warn(`transactionId=${txEntity.id} walletId=${txEntity.walletId} providerId=${txEntity.providerId} referência não encontrada após ${attempts} tentativas, rejeitada`);
                return true;
            }

            txEntity.referenceAttempts = attempts;
            txEntity.referenceNextAttemptAt = new Date(now.getTime() + this.computeBackoffMs(attempts));
            return true;
        });
    }

    private computeBackoffMs(attempts: number): number
    {
        const exp = Math.min(this.backoffBaseMs * 2 ** (attempts - 1), this.backoffMaxMs);
        return Math.floor(exp / 2 + Math.random() * (exp / 2));
    }
}
