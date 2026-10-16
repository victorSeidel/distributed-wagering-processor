import { Module } from "@nestjs/common";

import { ReferenceRetryPolicy } from "./services/reference-retry.policy";
import { WagerSettlementService } from "./services/wager-settlement.service";

import { GetWagerTransactionUseCase } from "./usecases/get-wager-transaction.usecase";
import { GetWalletLedgerUseCase } from "./usecases/get-wallet-ledger.usecase";
import { GetWalletUseCase } from "./usecases/get-wallet.usecase";
import { OpenWalletUseCase } from "./usecases/open-wallet.usecase";
import { ProcessPendingReferencesUseCase } from "./usecases/process-pending-references.usecase";
import { ProcessWagerUseCase } from "./usecases/process-wager.usecase";
import { ReconcileWalletUseCase } from "./usecases/reconcile-wallet.usecase";
import { PublishOutboxUseCase } from "./usecases/publish-outbox.usecase";

const USE_CASES = [
    OpenWalletUseCase,
    ProcessWagerUseCase,
    ProcessPendingReferencesUseCase,
    GetWalletUseCase,
    GetWalletLedgerUseCase,
    GetWagerTransactionUseCase,
    ReconcileWalletUseCase,
    PublishOutboxUseCase,
];

@Module({
    providers: [
        WagerSettlementService,
        ReferenceRetryPolicy,
        ...USE_CASES,
    ],
    
    exports: USE_CASES,
})

export class ApplicationModule {}