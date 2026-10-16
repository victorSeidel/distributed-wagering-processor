import { Money } from "../../../domain/shared/money";
import { Wallet } from "../../../domain/wallet/wallet";
import { WalletLedgerEntry } from "../../../domain/wallet/wallet-ledger-entry";
import { WalletEntity } from "../entities/wallet.entity";
import { WalletLedgerEntryEntity } from "../entities/wallet-ledger-entry.entity";

export class WalletMapper
{
    public static toDomain(entity: WalletEntity): Wallet
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

    public static toEntity(domain: Wallet): WalletEntity
    {
        const entity = new WalletEntity();
        WalletMapper.apply(entity, domain);
        entity.id = domain.id;
        entity.playerId = domain.playerId;
        entity.currency = domain.currency;
        entity.createdAt = domain.createdAt;
        return entity;
    }

    public static apply(entity: WalletEntity, domain: Wallet): void
    {
        entity.balance = domain.balance.toString();
        entity.version = domain.version;
        entity.updatedAt = domain.updatedAt;
    }

    public static ledgerToEntity(domain: WalletLedgerEntry): WalletLedgerEntryEntity
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
}