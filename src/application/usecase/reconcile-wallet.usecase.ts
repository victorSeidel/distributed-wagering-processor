import { Injectable, NotFoundException } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import Decimal from "decimal.js";
import type { WagerReconciliationResponseDto } from "../../model/dto/wager.dto";
import { WalletLedgerEntryEntity } from "../../infra/database/entities/wallet-ledger-entry.entity";
import { WalletEntity } from "../../infra/database/entities/wallet.entity";
import { LedgerDirection } from "../../model/type/wallet.type";
import type { Money as MoneyType } from "../../model/type/money.type";

@Injectable()
export class ReconcileWalletUseCase
{
    constructor(private readonly em: EntityManager) {}

    public async execute(walletId: string): Promise<WagerReconciliationResponseDto>
    {
        const forkEm = this.em.fork();

        const wallet = await forkEm.findOne(WalletEntity, { id: walletId });
        if (!wallet) throw new NotFoundException(`Wallet com id '${walletId}' não encontrada`);

        const entries = await forkEm.find(WalletLedgerEntryEntity, { walletId }, { orderBy: { createdAt: "ASC" } });

        let runningBalance = new Decimal(0);

        for (const entry of entries)
        {
            const entryAmount = new Decimal(entry.amount);
            if (entry.direction === LedgerDirection.Credit) runningBalance = runningBalance.plus(entryAmount);
            else if (entry.direction === LedgerDirection.Debit) runningBalance = runningBalance.minus(entryAmount);
        }

        const storedBalanceDecimal = new Decimal(wallet.balance);
        const differenceDecimal = storedBalanceDecimal.minus(runningBalance).abs();

        const storedBalance: MoneyType =
        {
            amount: storedBalanceDecimal.toFixed(2),
            currency: wallet.currency,
        };

        const calculatedBalance: MoneyType =
        {
            amount: runningBalance.toFixed(2),
            currency: wallet.currency,
        };

        const difference: MoneyType =
        {
            amount: differenceDecimal.toFixed(2),
            currency: wallet.currency,
        };

        const consistent = differenceDecimal.isZero();

        return {
            walletId,
            storedBalance,
            calculatedBalance,
            difference,
            consistent,
            checkedEntries: entries.length,
        };
    }
}