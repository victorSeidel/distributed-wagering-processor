import "reflect-metadata";
import { MikroORM } from "@mikro-orm/postgresql";

import mikroOrmConfig from "../../mikro-orm.config";

import { AppLogger, type LogFields } from "../../src/application/ports/observability.port";
import { IntegrationEventPublisher } from "../../src/application/ports/messaging.port";

import type { OutboxMessage } from "../../src/domain/messaging/outbox-message";

import { ReferenceRetryPolicy } from "../../src/application/services/reference-retry.policy";
import { WagerSettlementService } from "../../src/application/services/wager-settlement.service";

import { GetWagerTransactionUseCase } from "../../src/application/usecases/get-wager-transaction.usecase";
import { GetWalletLedgerUseCase } from "../../src/application/usecases/get-wallet-ledger.usecase";
import { GetWalletUseCase } from "../../src/application/usecases/get-wallet.usecase";
import { OpenWalletUseCase } from "../../src/application/usecases/open-wallet.usecase";
import { ProcessPendingReferencesUseCase } from "../../src/application/usecases/process-pending-references.usecase";
import { ProcessWagerUseCase } from "../../src/application/usecases/process-wager.usecase";
import { PublishOutboxUseCase } from "../../src/application/usecases/publish-outbox.usecase";
import { ReconcileWalletUseCase } from "../../src/application/usecases/reconcile-wallet.usecase";

import { MikroOrmUnitOfWork } from "../../src/infra/persistence/mikro-orm-unit-of-work";
import { MikroOrmWagerQueries, MikroOrmWalletQueries } from "../../src/infra/persistence/queries/mikro-orm-queries";
import { PrometheusMetrics } from "../../src/infra/observability/prometheus-metrics";

export class SilentLogger extends AppLogger
{
    public readonly entries: { level: string; message: string; fields?: LogFields }[] = [];
    
    info(message: string, fields?: LogFields) { this.entries.push({ level: "info", message, fields }); }
    warn(message: string, fields?: LogFields) { this.entries.push({ level: "warn", message, fields }); }
    error(message: string, fields?: LogFields) { this.entries.push({ level: "error", message, fields }); }
}

export class RecordingPublisher extends IntegrationEventPublisher
{
    public readonly published: OutboxMessage[] = [];
    public failWith?: Error;

    async publish(message: OutboxMessage): Promise<void>
    {
        if (this.failWith) throw this.failWith;
        this.published.push(message);
    }
}

export async function createTestContext(publisher: IntegrationEventPublisher = new RecordingPublisher())
{
    const orm = await MikroORM.init({ ...mikroOrmConfig, debug: false });

    const logger = new SilentLogger();
    const metrics = new PrometheusMetrics();
    const uow = new MikroOrmUnitOfWork(orm.em, metrics);
    const settlement = new WagerSettlementService(metrics);
    const policy = new ReferenceRetryPolicy();
    const walletQueries = new MikroOrmWalletQueries(orm.em);

    return {
        orm,
        logger,
        metrics,
        uow,
        policy,
        publisher,
        openWallet: new OpenWalletUseCase(uow, logger),
        processWager: new ProcessWagerUseCase(uow, settlement, metrics, logger),
        processPending: new ProcessPendingReferencesUseCase(uow, settlement, policy, metrics, logger),
        publishOutbox: new PublishOutboxUseCase(uow, publisher, metrics, logger),
        getWallet: new GetWalletUseCase(walletQueries),
        getLedger: new GetWalletLedgerUseCase(walletQueries),
        getTransaction: new GetWagerTransactionUseCase(new MikroOrmWagerQueries(orm.em)),
        reconcile: new ReconcileWalletUseCase(walletQueries, metrics, logger),
        close: () => orm.close(true),
    };
}

export type TestContext = Awaited<ReturnType<typeof createTestContext>>;