import { Injectable } from "@nestjs/common";
import type { EntityManager } from "@mikro-orm/postgresql";
import { v7 as uuidv7 } from "uuid";

import type { Money } from "../../domain/common/money";
import { WalletBalanceChanged, WagerTransactionProcessed, WagerTransactionRejected, WagerTransactionPendingReference } from "../../domain/common/integration-event";
import type { WagerTransaction } from "../../domain/wager/wager-transaction";
import { WalletLedgerEntry } from "../../domain/wallet/wallet-ledger-entry";
import type { Wallet } from "../../domain/wallet/wallet";

import { WagerFailureCode, WagerTransactionKind, WagerTransactionStatus } from "../../model/entity/wager.entity";
import { LedgerDirection } from "../../model/type/wallet.type";

import { WagerTransactionEntity } from "../../infra/database/entities/wager-transaction.entity";
import type { WalletEntity } from "../../infra/database/entities/wallet.entity";
import { DatabaseMapper } from "../../infra/database/database.mapper";
import { enqueueOutbox } from "../../infra/database/outbox.writer";

export interface SettlementOutcome
{
    transactionId: string;
    status: WagerTransactionStatus;
    balance: Money;
    failureCode?: WagerFailureCode;
}

export interface SettleParams
{
    walletEntity: WalletEntity;
    transaction: WagerTransaction;
    correlationId: string;
    existingEntity?: WagerTransactionEntity;
}

@Injectable()
export class WagerSettlementService
{
    public async settle(em: EntityManager, params: SettleParams): Promise<SettlementOutcome | undefined>
    {
        const { walletEntity, transaction, correlationId } = params;
        const wallet = DatabaseMapper.toWalletDomain(walletEntity);

        if (wallet.playerId !== transaction.playerId) return this.reject(em, params, wallet, WagerFailureCode.PlayerMismatch);

        let referenceTx: WagerTransaction | undefined;

        if (transaction.requiresReference())
        {
            const refEntity = await em.findOne(WagerTransactionEntity, {
                providerId: transaction.providerId,
                externalTransactionId: transaction.referenceExternalTransactionId,
            });

            referenceTx = refEntity ? DatabaseMapper.toWagerDomain(refEntity) : undefined;
            if (!referenceTx || transaction.isReferenceUnresolved(referenceTx)) return undefined;

            const referenceFailure = transaction.evaluateReference(referenceTx);
            if (referenceFailure) return this.reject(em, params, wallet, referenceFailure);

            const alreadyReversed = await em.findOne(WagerTransactionEntity, {
                referenceTransactionId: referenceTx.id,
                kind: transaction.kind,
                status: WagerTransactionStatus.Processed,
            });

            if (alreadyReversed) return this.reject(em, params, wallet, WagerFailureCode.ReferenceAlreadyReversed);
        }

        const balanceBefore = wallet.balance;
        const money = transaction.money;
        let direction: LedgerDirection | undefined;

        if (transaction.affectsBalance())
        {
            direction = transaction.ledgerDirectionFor(referenceTx);

            if (direction === LedgerDirection.Debit)
            {
                if (wallet.balance.isLessThan(money))
                {
                    const failure = transaction.kind === WagerTransactionKind.Bet
                        ? WagerFailureCode.InsufficientFunds
                        : WagerFailureCode.ReversalWouldProduceNegativeBalance;

                    return this.reject(em, params, wallet, failure);
                }

                wallet.debit(money);
            }
            else
            {
                wallet.credit(money);
            }
        }

        transaction.markProcessed(referenceTx?.id, new Date());
        this.persistTransaction(em, params, wallet.balance);

        if (direction)
        {
            const entry = WalletLedgerEntry.create({
                id: uuidv7(),
                walletId: wallet.id,
                transactionId: transaction.id,
                direction,
                money,
                balanceBefore,
                balanceAfter: wallet.balance,
            });

            walletEntity.balance = wallet.balance.toString();
            walletEntity.version = wallet.version;
            walletEntity.updatedAt = wallet.updatedAt;

            em.persist(DatabaseMapper.toLedgerEntity(entry));

            enqueueOutbox(em, new WalletBalanceChanged({
                aggregateId: wallet.id,
                correlationId,
                data: {
                    walletId: wallet.id,
                    transactionId: transaction.id,
                    direction,
                    money: money.toJSON(),
                    balanceBefore: balanceBefore.toJSON(),
                    balanceAfter: wallet.balance.toJSON(),
                    walletVersion: wallet.version,
                },
            }));
        }

        enqueueOutbox(em, new WagerTransactionProcessed({
            aggregateId: transaction.id,
            correlationId,
            data: {
                transactionId: transaction.id,
                providerId: transaction.providerId,
                externalTransactionId: transaction.externalTransactionId,
                walletId: wallet.id,
                playerId: wallet.playerId,
                roundId: transaction.roundId,
                gameId: transaction.gameId,
                kind: transaction.kind,
                money: money.toJSON(),
                balanceAfter: wallet.balance.toJSON(),
            },
        }));

        return this.outcome(transaction, wallet);
    }

    public registerPendingReference(em: EntityManager, params: SettleParams): SettlementOutcome
    {
        const { walletEntity, transaction, correlationId } = params;
        const wallet = DatabaseMapper.toWalletDomain(walletEntity);

        transaction.markPendingReference();
        this.persistTransaction(em, params, wallet.balance);

        enqueueOutbox(em, new WagerTransactionPendingReference({
            aggregateId: transaction.id,
            correlationId,
            data: {
                transactionId: transaction.id,
                providerId: transaction.providerId,
                externalTransactionId: transaction.externalTransactionId,
                referenceExternalTransactionId: transaction.referenceExternalTransactionId!,
                walletId: wallet.id,
                playerId: wallet.playerId,
                kind: transaction.kind,
            },
        }));

        return this.outcome(transaction, wallet);
    }

    public reject(em: EntityManager, params: SettleParams, wallet: Wallet, code: WagerFailureCode): SettlementOutcome
    {
        const { transaction, correlationId } = params;

        transaction.reject(code);
        this.persistTransaction(em, params, wallet.balance);

        enqueueOutbox(em, new WagerTransactionRejected({
            aggregateId: transaction.id,
            correlationId,
            data: {
                transactionId: transaction.id,
                providerId: transaction.providerId,
                externalTransactionId: transaction.externalTransactionId,
                walletId: wallet.id,
                playerId: wallet.playerId,
                kind: transaction.kind,
                failureCode: code,
            },
        }));

        return this.outcome(transaction, wallet);
    }

    private persistTransaction(em: EntityManager, params: SettleParams, balanceAfter: Money): void
    {
        const { transaction, existingEntity } = params;

        if (existingEntity)
        {
            DatabaseMapper.applyWagerState(existingEntity, transaction);
            existingEntity.balanceAfter = balanceAfter.toString();
            existingEntity.referenceNextAttemptAt = null;
            return;
        }

        const entity = DatabaseMapper.toWagerEntity(transaction);
        entity.balanceAfter = balanceAfter.toString();
        em.persist(entity);
    }

    private outcome(transaction: WagerTransaction, wallet: Wallet): SettlementOutcome
    {
        return {
            transactionId: transaction.id,
            status: transaction.status,
            balance: wallet.balance,
            failureCode: transaction.failureCode,
        };
    }
}