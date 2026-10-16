import { Injectable } from "@nestjs/common";
import { ConnectionException, DeadlockException, LockWaitTimeoutException, UniqueConstraintViolationException } from "@mikro-orm/core";
import { EntityManager } from "@mikro-orm/postgresql";

import { TransientError } from "../../domain/shared/errors";

import { UniqueViolationError } from "../../application/errors";
import { Metrics } from "../../application/ports/observability.port";
import { UnitOfWork, type TransactionScope } from "../../application/ports/unit-of-work.port";

import { MikroOrmWagerTransactionRepository } from "./repositories/mikro-orm-wager-transaction.repository";
import { MikroOrmInboxRepository, MikroOrmKeyLock, MikroOrmLedgerRepository, MikroOrmOutboxRepository } from "./repositories/mikro-orm-messaging.repositories";
import { MikroOrmWalletRepository } from "./repositories/mikro-orm-wallet.repository";

@Injectable()
export class MikroOrmUnitOfWork extends UnitOfWork
{
    constructor(private readonly em: EntityManager, private readonly metrics: Metrics)
    {
        super();
    }

    public async run<T>(work: (scope: TransactionScope) => Promise<T>): Promise<T>
    {
        try
        {
            return await this.em.transactional((em) => work(this.createScope(em)));
        }
        catch (err)
        {
            throw this.translate(err);
        }
    }

    private createScope(em: EntityManager): TransactionScope
    {
        return {
            wallets: new MikroOrmWalletRepository(em, this.metrics),
            transactions: new MikroOrmWagerTransactionRepository(em),
            ledger: new MikroOrmLedgerRepository(em),
            inbox: new MikroOrmInboxRepository(em),
            outbox: new MikroOrmOutboxRepository(em),
            locks: new MikroOrmKeyLock(em, this.metrics),
        };
    }

    private translate(err: unknown): unknown
    {
        if (err instanceof UniqueConstraintViolationException)
        {
            const constraint = (err as { constraint?: string }).constraint ?? /constraint "([^"]+)"/.exec(err.message)?.[1] ?? "unknown";
            return new UniqueViolationError(constraint);
        }

        if (err instanceof DeadlockException)
        {
            this.metrics.lockConflict("deadlock");
            return new TransientError("Deadlock detectado no banco de dados; a operação pode ser reenviada");
        }

        if (err instanceof LockWaitTimeoutException || err instanceof ConnectionException)
            return new TransientError("Banco de dados temporariamente indisponível; a operação pode ser reenviada");

        return err;
    }
}