import { type CreateLedgerEntryDto, type LedgerEntryState } from "../../model/dto/wallet.dto";
import { LedgerDirection } from "../../model/type/wallet.type";
import type { Money } from "../common/money";

export class WalletLedgerEntry
{
    private constructor(
        public readonly id: string,
        public readonly walletId: string,
        public readonly transactionId: string,
        public readonly direction: LedgerDirection,
        public readonly money: Money,
        public readonly balanceBefore: Money,
        public readonly balanceAfter: Money,
        public readonly createdAt: Date,
    ) {}

    public static create(dto: CreateLedgerEntryDto): WalletLedgerEntry
    {
        const entry = new WalletLedgerEntry(
            dto.id,
            dto.walletId,
            dto.transactionId,
            dto.direction,
            dto.money,
            dto.balanceBefore,
            dto.balanceAfter, new Date()
        );

        if (!entry.isBalanced()) throw new Error(`Invariante violada: before (${dto.balanceBefore}) ± money (${dto.money}) !== afeter (${dto.balanceAfter})`);

        return entry;
    }

    public static rehydrate(state: LedgerEntryState): WalletLedgerEntry
    {
        return new WalletLedgerEntry(
            state.id,
            state.walletId,
            state.transactionId,
            state.direction,
            state.money,
            state.balanceBefore,
            state.balanceAfter,
            state.createdAt,
        );
    }

    public isBalanced(): boolean
    {
        if (this.direction === LedgerDirection.Credit) return this.balanceBefore.add(this.money).equals(this.balanceAfter);
        if (this.direction === LedgerDirection.Debit) return this.balanceBefore.subtract(this.money).equals(this.balanceAfter);
        return false;
    }
}