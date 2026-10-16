import type { InboxRepository, KeyLock, LedgerRepository, OutboxRepository, WagerTransactionRepository, WalletRepository } from "./repositories.port";

/** Repositórios vinculados a UMA transação SQL.
 * Tudo o que passa por aqui é confirmado ou desfeito junto.
 */
export interface TransactionScope
{
    readonly wallets: WalletRepository;
    readonly transactions: WagerTransactionRepository;
    readonly ledger: LedgerRepository;
    readonly inbox: InboxRepository;
    readonly outbox: OutboxRepository;
    readonly locks: KeyLock;
}

/**
 * Fronteira transacional. Wallet, transação, ledger, inbox e outbox compartilham a mesma transação SQL.
 * o commit só ocorre se `work` terminar sem erro. Classe abstrata para servir de token de injeção.
 */
export abstract class UnitOfWork
{
    abstract run<T>(work: (scope: TransactionScope) => Promise<T>): Promise<T>;
}