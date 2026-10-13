import { Money } from "../../domain/common/money";
import { WagerTransaction } from "../../domain/wager/wager-transaction";
import { Wallet } from "../../domain/wallet/wallet";
import type { WalletLedgerEntry } from "../../domain/wallet/wallet-ledger-entry";
import { WagerTransactionEntity } from "./entities/wager-transaction.entity";
import { WalletLedgerEntryEntity } from "./entities/wallet-ledger-entry.entity";
import { WalletEntity } from "./entities/wallet.entity";

export class DatabaseMapper
{
    public static toWalletDomain(entity: WalletEntity): Wallet
    {
        return Wallet.rehydrate({
            id: entity.id,
            playerId: entity.playerId,
            currency: entity.currency,
            balance: Money.from({ amount: entity.balance, currency: entity.currency }),
            version: entity.version,
            createdAt: entity.createdAt,
            updatedAt: entity.updatedAt,
        });
    }

    public static toWalletEntity(domain: Wallet): WalletEntity
    {
        const entity = new WalletEntity();
        entity.id = domain.id;
        entity.playerId = domain.playerId;
        entity.currency = domain.currency;
        entity.balance = domain.balance.toString();
        entity.version = domain.version;
        entity.createdAt = domain.createdAt;
        entity.updatedAt = domain.updatedAt;
        return entity;
    }

    public static toLedgerEntity(domain: WalletLedgerEntry): WalletLedgerEntryEntity
    {
        const entity = new WalletLedgerEntryEntity();
        entity.id = domain.id;
        entity.walletId = domain.walletId;
        entity.transactionId = domain.transactionId;
        entity.direction = domain.direction;
        entity.amount = domain.money.toString();
        entity.currency = domain.money.currency;
        entity.balanceBefore = domain.balanceBefore.toString();
        entity.balanceAfter = domain.balanceAfter.toString();
        entity.createdAt = domain.createdAt;
        return entity;
    }

    public static toWagerDomain(entity: WagerTransactionEntity): WagerTransaction
    {
        return WagerTransaction.rehydrate({
            id: entity.id,
            providerId: entity.providerId,
            externalTransactionId: entity.externalTransactionId,
            idempotencyKey: entity.idempotencyKey,
            payloadHash: entity.payloadHash,
            walletId: entity.walletId,
            playerId: entity.playerId,
            roundId: entity.roundId,
            gameId: entity.gameId,
            kind: entity.kind,
            money: Money.from({ amount: entity.amount, currency: entity.currency }),
            referenceExternalTransactionId: entity.referenceExternalTransactionId ?? undefined,
            referenceTransactionId: entity.referenceTransactionId ?? undefined,
            status: entity.status,
            failureCode: entity.failureCode ?? undefined,
            processedAt: entity.processedAt ?? undefined,
            createdAt: entity.createdAt,
        });
    }

    public static toWagerEntity(domain: WagerTransaction): WagerTransactionEntity
    {
        const entity = new WagerTransactionEntity();
        entity.id = domain.id;
        entity.providerId = domain.providerId;
        entity.externalTransactionId = domain.externalTransactionId;
        entity.idempotencyKey = domain.idempotencyKey;
        entity.payloadHash = domain.payloadHash;
        entity.walletId = domain.walletId;
        entity.playerId = domain.playerId;
        entity.roundId = domain.roundId;
        entity.gameId = domain.gameId;
        entity.kind = domain.kind;
        entity.amount = domain.money.toString();
        entity.currency = domain.money.currency;
        entity.referenceExternalTransactionId = domain.referenceExternalTransactionId;
        entity.referenceTransactionId = domain.referenceTransactionId;
        entity.status = domain.status;
        entity.failureCode = domain.failureCode;
        entity.processedAt = domain.processedAt;
        entity.createdAt = domain.createdAt;
        return entity;
    }
}