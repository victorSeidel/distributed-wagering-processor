import type { Money } from "../../domain/common/money";
import type { LedgerDirection } from "../type/wallet.type";

export interface OpenWalletDto
{
    id: string;
    playerId: string;
    initialBalance: Money;
}

export interface WalletState
{
    id: string;
    playerId: string;
    currency: string;
    balance: Money;
    version: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateLedgerEntryDto
{
    id: string;
    walletId: string;
    transactionId: string;
    direction: LedgerDirection;
    money: Money;
    balanceBefore: Money;
    balanceAfter: Money;
}

export interface LedgerEntryState
{
    id: string;
    walletId: string;
    transactionId: string;
    direction: LedgerDirection;
    money: Money;
    balanceBefore: Money;
    balanceAfter: Money;
    createdAt: Date;
}