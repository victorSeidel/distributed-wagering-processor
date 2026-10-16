import { Injectable } from "@nestjs/common";

import { Money } from "../../domain/shared/money";

import type { ReconciliationResponse } from "../dto/wallet.dto";

import { WalletNotFoundError } from "../errors";

import { AppLogger, Metrics } from "../ports/observability.port";
import { WalletQueries } from "../ports/queries.port";

import { assertUuid } from "../validation/input-validation";

@Injectable()
export class ReconcileWalletUseCase
{
    constructor(
        private readonly queries: WalletQueries,
        private readonly metrics: Metrics,
        private readonly logger: AppLogger,
    ) {}

    public async execute(walletId: string): Promise<ReconciliationResponse>
    {
        assertUuid(walletId, "walletId");

        const snapshot = await this.queries.reconciliationSnapshot(walletId);
        if (!snapshot) throw new WalletNotFoundError(walletId);

        const stored = Money.fromSigned(snapshot.storedBalance);
        const calculated = Money.fromSigned(snapshot.ledgerBalance);
        const difference = stored.subtract(calculated);
        const consistent = difference.isZero();

        if (!consistent)
        {
            this.metrics.reconciliationDivergence();
            this.logger.error("Divergência detectada na reconciliação da wallet", { walletId, checkedEntries: snapshot.checkedEntries });
        }

        return {
            walletId,
            storedBalance: stored.toJSON(),
            calculatedBalance: calculated.toJSON(),
            difference: difference.toJSON(),
            consistent,
            checkedEntries: snapshot.checkedEntries,
        };
    }
}