import { Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";

import type { MoneyProps } from "../../../domain/shared/money";
import type { LedgerDirection } from "../../../domain/wallet/ledger-direction";
import { WagerQueries, WalletQueries, type LedgerEntryView, type LedgerPosition, type ReconciliationSnapshot, type WagerTransactionView, type WalletView } from "../../../application/ports/queries.port";
import { WagerTransactionEntity } from "../entities/wager-transaction.entity";
import { WalletEntity } from "../entities/wallet.entity";

interface LedgerRow
{
    id: string;
    transaction_id: string;
    direction: LedgerDirection;
    amount: string;
    currency: string;
    balance_before: string;
    balance_after: string;
    created_at: Date;
}

interface ReconciliationRow
{
    currency: string;
    stored: string;
    calculated: string;
    entries: string | number;
}

@Injectable()
export class MikroOrmWalletQueries extends WalletQueries
{
    constructor(private readonly em: EntityManager)
    {
        super();
    }

    public async findWallet(walletId: string): Promise<WalletView | undefined>
    {
        const wallet = await this.em.fork().findOne(WalletEntity, { id: walletId });
        if (!wallet) return undefined;

        return {
            id: wallet.id,
            playerId: wallet.playerId,
            balance: { amount: wallet.balance, currency: wallet.currency },
            version: wallet.version,
            createdAt: wallet.createdAt,
            updatedAt: wallet.updatedAt,
        };
    }

    public async listLedger(walletId: string, limit: number, after?: LedgerPosition): Promise<LedgerEntryView[]>
    {
        const params: unknown[] = [walletId];
        let cursorCondition = "";

        if (after)
        {
            cursorCondition = "AND (created_at, id) < (?, ?)";
            params.push(after.createdAt, after.id);
        }

        const rows = await this.em.fork().execute<LedgerRow[]>(
            `SELECT id, transaction_id, direction, amount, currency, balance_before, balance_after, created_at
             FROM wallet_ledger_entries
             WHERE wallet_id = ? ${cursorCondition}
             ORDER BY created_at DESC, id DESC LIMIT ?`,
            [...params, limit],
        );

        return rows.map((row) => ({
            id: row.id,
            transactionId: row.transaction_id,
            direction: row.direction,
            money: { amount: row.amount, currency: row.currency },
            balanceBefore: { amount: row.balance_before, currency: row.currency },
            balanceAfter: { amount: row.balance_after, currency: row.currency },
            createdAt: new Date(row.created_at),
        }));
    }

    public async reconciliationSnapshot(walletId: string): Promise<ReconciliationSnapshot | undefined>
    {
        // Uma única instrução SQL: saldo armazenado e soma do ledger vêm do mesmo snapshot, sem falsa divergência sob escrita concorrente.
        const rows = await this.em.fork().execute<ReconciliationRow[]>(
            `SELECT w.currency AS currency,
                    w.balance AS stored,
                    COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.amount ELSE -l.amount END), 0) AS calculated,
                    COUNT(l.id) AS entries
             FROM wallets w
             LEFT JOIN wallet_ledger_entries l ON l.wallet_id = w.id
             WHERE w.id = ?
             GROUP BY w.id`,
            [walletId],
        );

        const row = rows[0];
        if (!row) return undefined;

        const money = (amount: string): MoneyProps => ({ amount: String(amount), currency: row.currency });

        return {
            storedBalance: money(row.stored),
            ledgerBalance: money(row.calculated),
            checkedEntries: Number(row.entries),
        };
    }
}

@Injectable()
export class MikroOrmWagerQueries extends WagerQueries
{
    constructor(private readonly em: EntityManager)
    {
        super();
    }

    public async findById(transactionId: string): Promise<WagerTransactionView | undefined>
    {
        return this.toView(await this.em.fork().findOne(WagerTransactionEntity, { id: transactionId }));
    }

    public async findByProviderAndExternalId(providerId: string, externalTransactionId: string): Promise<WagerTransactionView | undefined>
    {
        return this.toView(await this.em.fork().findOne(WagerTransactionEntity, { providerId, externalTransactionId }));
    }

    private toView(entity: WagerTransactionEntity | null): WagerTransactionView | undefined
    {
        if (!entity) return undefined;

        return {
            id: entity.id,
            providerId: entity.providerId,
            externalTransactionId: entity.externalTransactionId,
            walletId: entity.walletId,
            playerId: entity.playerId,
            roundId: entity.roundId,
            gameId: entity.gameId,
            kind: entity.kind,
            money: { amount: entity.amount, currency: entity.currency },
            status: entity.status,
            failureCode: entity.failureCode ?? undefined,
            referenceExternalTransactionId: entity.referenceExternalTransactionId ?? undefined,
            referenceTransactionId: entity.referenceTransactionId ?? undefined,
            balanceAfter: entity.balanceAfter ? { amount: entity.balanceAfter, currency: entity.currency } : undefined,
            createdAt: entity.createdAt,
            processedAt: entity.processedAt ?? undefined,
        };
    }
}
