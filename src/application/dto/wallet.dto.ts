import type { MoneyProps } from "../../domain/shared/money";
import type { LedgerDirection } from "../../domain/wallet/ledger-direction";

export interface OpenWalletCommand
{
    playerId: string;
    initialBalance: MoneyProps;
}

export interface OpenWalletResult
{
    id: string;
    playerId: string;
    balance: MoneyProps;
    version: number;
}

export interface WalletResponse extends OpenWalletResult
{
    createdAt: string;
    updatedAt: string;
}

export interface LedgerItemResponse
{
    id: string;
    transactionId: string;
    direction: LedgerDirection;
    money: MoneyProps;
    balanceBefore: MoneyProps;
    balanceAfter: MoneyProps;
    createdAt: string;
}

export interface LedgerPageResponse
{
    items: LedgerItemResponse[];
    nextCursor?: string;
    hasMore: boolean;
}

export interface ReconciliationResponse
{
    walletId: string;
    storedBalance: MoneyProps;
    calculatedBalance: MoneyProps;
    difference: MoneyProps;
    consistent: boolean;
    checkedEntries: number;
}