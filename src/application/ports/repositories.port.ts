import type { InboxMessage } from "../../domain/messaging/inbox-message";
import type { OutboxMessage } from "../../domain/messaging/outbox-message";
import type { WagerTransaction } from "../../domain/wager/wager-transaction";
import type { WagerTransactionKind } from "../../domain/wager/wager-transaction.types";
import type { Wallet } from "../../domain/wallet/wallet";
import type { WalletLedgerEntry } from "../../domain/wallet/wallet-ledger-entry";

export const UniqueConstraints =
{
    WalletPlayerCurrency: "uk_wallets_player_currency",
    WagerProviderExternalTransaction: "uq_wagers_provider_external_tx",
} as const;

export interface WalletRepository
{
    findByIdForUpdate(walletId: string): Promise<Wallet | undefined>;
    findById(walletId: string): Promise<Wallet | undefined>;
    existsForPlayer(playerId: string, currency: string): Promise<boolean>;
    add(wallet: Wallet): void;
    save(wallet: Wallet): void;
}

export interface WagerTransactionRepository
{
    findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | undefined>;
    findByProviderAndExternalId(providerId: string, externalTransactionId: string): Promise<WagerTransaction | undefined>;
    hasProcessedReversal(referenceTransactionId: string, kind: WagerTransactionKind): Promise<boolean>;
    claimNextPendingReference(now: Date): Promise<WagerTransaction | undefined>;
    add(transaction: WagerTransaction): void;
    save(transaction: WagerTransaction): void;
}

export interface LedgerRepository
{
    add(entry: WalletLedgerEntry): void;
}

export interface InboxRepository
{
    findByKey(consumerName: string, messageId: string): Promise<InboxMessage | undefined>;
    add(message: InboxMessage): void;
    save(message: InboxMessage): void;
}

export interface OutboxRepository
{
    enqueue(message: OutboxMessage): void;
    claimDue(now: Date, limit: number): Promise<OutboxMessage[]>;
    save(message: OutboxMessage): void;
    oldestPendingSince(): Promise<Date | undefined>;
}

export interface KeyLock
{
    acquire(key: string): Promise<void>;
}