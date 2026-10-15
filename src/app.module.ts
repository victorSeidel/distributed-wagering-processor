import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";

import { MikroOrmModule } from "@mikro-orm/nestjs";
import mikroOrmConfig from "../mikro-orm.config";

import { WalletsController } from "./application/controller/wallet.controller";
import { WageringController } from "./application/controller/wagering.controller";
import { HealthController } from "./application/controller/health.controller";

import { OpenWalletUseCase } from "./application/usecase/open-wallet.usecase";
import { ProcessWagerUseCase } from "./application/usecase/process-wager.usecase";
import { ReconcileWalletUseCase } from "./application/usecase/reconcile-wallet.usecase";
import { GetWalletLedgerUseCase } from "./application/usecase/get-wallet-ledger.usecase";

import { BusinessErrorFilter } from "./infra/filter/business-error-filter";
import { MessagingModule } from "./infra/messaging/messaging.module";
import { PendingReferenceRetryWorker } from "./infra/worker/pending-reference-retry.worker";
import { StructuredLogger } from "./infra/structured-logger.service";

@Module({
    imports: [
        MikroOrmModule.forRoot(mikroOrmConfig),
        MessagingModule,
    ],

    controllers: [
        WalletsController,
        WageringController,
        HealthController,
    ],

    providers: [
        OpenWalletUseCase,
        ProcessWagerUseCase,
        ReconcileWalletUseCase,
        GetWalletLedgerUseCase,
        PendingReferenceRetryWorker,
        StructuredLogger,
        { provide: APP_FILTER, useClass: BusinessErrorFilter },
    ],
})

export class AppModule {}