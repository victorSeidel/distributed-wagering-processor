import { Injectable, type OnModuleInit, type OnModuleDestroy, Logger } from "@nestjs/common";
import { EntityManager, LockMode } from "@mikro-orm/postgresql";

import { v7 as uuidv7 } from "uuid";

import { WagerTransactionEntity } from "../database/entities/wager-transaction.entity";
import { WalletEntity } from "../database/entities/wallet.entity";
import { OutboxMessageEntity } from "../database/entities/messaging.entity";
import { DatabaseMapper } from "../database/database.mapper";

import { LedgerDirection } from "../../model/type/wallet.type";
import { WagerFailureCode, WagerTransactionStatus } from "../../model/entity/wager.entity";

import { WagerTransactionProcessed, WagerTransactionRejected, WalletBalanceChanged } from "../../domain/common/integration-event";
import { WalletLedgerEntry } from "../../domain/wallet/wallet-ledger-entry";

@Injectable()
export class PendingReferenceRetryWorker implements OnModuleInit, OnModuleDestroy
{
    private readonly logger = new Logger(PendingReferenceRetryWorker.name);
    private isRunning = false;
    private intervalRef: NodeJS.Timeout | null = null;
    private isProcessing = false;
    private readonly ttlMs = 5 * 60 * 1000;

    constructor(private readonly em: EntityManager) {}

    onModuleInit()
    {
        this.isRunning = true;
        this.intervalRef = setInterval(() => this.processPendingReferences(), 3000);
        this.logger.log("PendingReferenceRetryWorker inicializado.");
    }

    onModuleDestroy()
    {
        this.isRunning = false;
        if (this.intervalRef) clearInterval(this.intervalRef);
        this.logger.log("PendingReferenceRetryWorker finalizado.");
    }

    public async processPendingReferences(): Promise<void>
    {
        if (!this.isRunning || this.isProcessing) return;
        this.isProcessing = true;

        const forkEm = this.em.fork();

        try
        {
            const pendingEntities = await forkEm.find(
                WagerTransactionEntity,
                { status: WagerTransactionStatus.PendingReference },
                { limit: 20, orderBy: { createdAt: "ASC" } }
            );

            for (const txEntity of pendingEntities)
            {
                await forkEm.transactional(async (em) =>
                {
                    const now = new Date();
                    const ageMs = now.getTime() - txEntity.createdAt.getTime();

                    if (ageMs > this.ttlMs)
                    {
                        txEntity.status = WagerTransactionStatus.Rejected;
                        txEntity.failureCode = WagerFailureCode.ReferenceNotFound;
                        txEntity.processedAt = now;
                        txEntity.balanceAfter = null;

                        const rejectedEvent = new WagerTransactionRejected({
                            aggregateId: txEntity.id,
                            correlationId: uuidv7(),
                            data: {
                                transactionId: txEntity.id,
                                providerId: txEntity.providerId,
                                externalTransactionId: txEntity.externalTransactionId,
                                walletId: txEntity.walletId,
                                playerId: txEntity.playerId,
                                kind: txEntity.kind,
                                failureCode: WagerFailureCode.ReferenceNotFound,
                            },
                        });

                        this.enqueueOutbox(em, rejectedEvent);
                        return;
                    }

                    const refEntity = await em.findOne(WagerTransactionEntity, {
                        providerId: txEntity.providerId,
                        externalTransactionId: txEntity.referenceExternalTransactionId,
                        status: WagerTransactionStatus.Processed,
                    });

                    if (!refEntity) return;

                    const walletEntity = await em.findOne(
                        WalletEntity,
                        { id: txEntity.walletId },
                        { lockMode: LockMode.PESSIMISTIC_WRITE }
                    );

                    if (!walletEntity) return;

                    const wallet = DatabaseMapper.toWalletDomain(walletEntity);
                    const tx = DatabaseMapper.toWagerDomain(txEntity);
                    const refTx = DatabaseMapper.toWagerDomain(refEntity);

                    if (!refTx.money.equals(tx.money) || refTx.roundId !== tx.roundId)
                    {
                        tx.reject(WagerFailureCode.AmountMismatch);
                        txEntity.status = tx.status;
                        txEntity.failureCode = tx.failureCode;
                        txEntity.processedAt = tx.processedAt;
                        txEntity.balanceAfter = wallet.balance.toString();
                        return;
                    }

                    const balanceBefore = wallet.balance;
                    const direction = tx.ledgerDirectionFor(refTx);

                    if (direction === LedgerDirection.Debit)
                    {
                        if (wallet.balance.isLessThan(tx.money))
                        {
                            tx.reject(WagerFailureCode.ReversalWouldProduceNegativeBalance);
                            txEntity.status = tx.status;
                            txEntity.failureCode = tx.failureCode;
                            txEntity.processedAt = tx.processedAt;
                        txEntity.balanceAfter = wallet.balance.toString();
                            return;
                        }

                        wallet.debit(tx.money);
                    }
                    else
                    {
                        wallet.credit(tx.money);
                    }

                    tx.markProcessed(refTx.id, now);

                    txEntity.status = tx.status;
                    txEntity.referenceTransactionId = refTx.id;
                    txEntity.processedAt = now;
                    txEntity.balanceAfter = wallet.balance.toString();

                    walletEntity.balance = wallet.balance.toString();
                    walletEntity.version = wallet.version;
                    walletEntity.updatedAt = wallet.updatedAt;

                    const ledgerEntry = WalletLedgerEntry.create({
                        id: uuidv7(),
                        walletId: wallet.id,
                        transactionId: tx.id,
                        direction,
                        money: tx.money,
                        balanceBefore,
                        balanceAfter: wallet.balance,
                    });

                    em.persist(DatabaseMapper.toLedgerEntity(ledgerEntry));

                    const correlationId = uuidv7();
                    const balanceEvent = new WalletBalanceChanged({
                        aggregateId: wallet.id,
                        correlationId,
                        data: {
                            walletId: wallet.id,
                            transactionId: tx.id,
                            direction,
                            money: tx.money.toJSON(),
                            balanceBefore: balanceBefore.toJSON(),
                            balanceAfter: wallet.balance.toJSON(),
                            walletVersion: wallet.version,
                        },
                    });

                    this.enqueueOutbox(em, balanceEvent);

                    const processedEvent = new WagerTransactionProcessed({
                        aggregateId: tx.id,
                        correlationId,
                        data: {
                            transactionId: tx.id,
                            providerId: tx.providerId,
                            externalTransactionId: tx.externalTransactionId,
                            walletId: wallet.id,
                            playerId: wallet.playerId,
                            roundId: tx.roundId,
                            gameId: tx.gameId,
                            kind: tx.kind,
                            money: tx.money.toJSON(),
                            balanceAfter: wallet.balance.toJSON(),
                        },
                    });

                    this.enqueueOutbox(em, processedEvent);
                });
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

    private enqueueOutbox(em: EntityManager, event: { aggregateId: string; eventType: string; toJSON: () => Record<string, unknown> }): void
    {
        const outboxEntity = new OutboxMessageEntity();
        outboxEntity.id = uuidv7();
        outboxEntity.aggregateId = event.aggregateId;
        outboxEntity.eventType = event.eventType;
        outboxEntity.payload = event.toJSON();
        outboxEntity.occurredAt = new Date();
        outboxEntity.nextAttemptAt = new Date();
        outboxEntity.attempts = 0;
        em.persist(outboxEntity);
    }
}