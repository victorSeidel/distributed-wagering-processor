import type { MoneyProps } from "../../domain/shared/money";
import type { WagerFailureCode, WagerTransactionKind, WagerTransactionStatus } from "../../domain/wager/wager-transaction.types";
import type { LedgerDirection } from "../../domain/wallet/ledger-direction";

export interface WalletView
{
    id: string;
    playerId: string;
    balance: MoneyProps;
    version: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface LedgerEntryView
{
    id: string;
    transactionId: string;
    direction: LedgerDirection;
    money: MoneyProps;
    balanceBefore: MoneyProps;
    balanceAfter: MoneyProps;
    createdAt: Date;
}

export interface LedgerPosition
{
    createdAt: Date;
    id: string;
}

export interface ReconciliationSnapshot
{
    storedBalance: MoneyProps;
    ledgerBalance: MoneyProps;
    checkedEntries: number;
}

export interface WagerTransactionView
{
    id: string;
    providerId: string;
    externalTransactionId: string;
    walletId: string;
    playerId: string;
    roundId: string;
    gameId: string;
    kind: WagerTransactionKind;
    money: MoneyProps;
    status: WagerTransactionStatus;
    failureCode?: WagerFailureCode;
    referenceExternalTransactionId?: string;
    referenceTransactionId?: string;
    balanceAfter?: MoneyProps;
    createdAt: Date;
    processedAt?: Date;
}

export abstract class WalletQueries
{
    abstract findWallet(walletId: string): Promise<WalletView | undefined>;
    abstract listLedger(walletId: string, limit: number, after?: LedgerPosition): Promise<LedgerEntryView[]>;
    abstract reconciliationSnapshot(walletId: string): Promise<ReconciliationSnapshot | undefined>;
}

export abstract class WagerQueries
{
    abstract findById(transactionId: string): Promise<WagerTransactionView | undefined>;
    abstract findByProviderAndExternalId(providerId: string, externalTransactionId: string): Promise<WagerTransactionView | undefined>;
}