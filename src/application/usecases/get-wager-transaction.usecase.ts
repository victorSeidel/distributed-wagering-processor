import { Injectable } from "@nestjs/common";

import type { WagerTransactionResponse } from "../dto/wager.dto";
import { TransactionNotFoundError } from "../errors";
import { WagerQueries, type WagerTransactionView } from "../ports/queries.port";
import { assertText, assertUuid } from "../validation/input-validation";

@Injectable()
export class GetWagerTransactionUseCase
{
    constructor(private readonly queries: WagerQueries) {}

    public async byId(transactionId: string): Promise<WagerTransactionResponse>
    {
        assertUuid(transactionId, "transactionId");

        const view = await this.queries.findById(transactionId);
        if (!view) throw new TransactionNotFoundError(`Transação '${transactionId}' não encontrada`);

        return this.toResponse(view);
    }

    public async byExternalId(providerId: string, externalTransactionId: string): Promise<WagerTransactionResponse>
    {
        assertText(providerId, "providerId");
        assertText(externalTransactionId, "externalTransactionId");

        const view = await this.queries.findByProviderAndExternalId(providerId, externalTransactionId);
        if (!view) throw new TransactionNotFoundError(`Transação externa '${externalTransactionId}' do provedor '${providerId}' não encontrada`);

        return this.toResponse(view);
    }

    private toResponse(view: WagerTransactionView): WagerTransactionResponse
    {
        return {
            ...view,
            createdAt: view.createdAt.toISOString(),
            processedAt: view.processedAt?.toISOString(),
        };
    }
}