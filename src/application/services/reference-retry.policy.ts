import { Injectable } from "@nestjs/common";

import type { WagerTransaction } from "../../domain/wager/wager-transaction";

/**
 * Política de reprocessamento de REFUND/ROLLBACK que chegaram antes da referência.
 * Limite: TTL de 5 min desde a criação OU 10 tentativas, o que ocorrer primeiro.
 * Esgotado, a transação é REJECTED com REFERENCE_NOT_FOUND.
 */
@Injectable()
export class ReferenceRetryPolicy
{
    public readonly ttlMs = 5 * 60 * 1000;
    public readonly maxAttempts = 10;
    private readonly baseDelayMs = 2000;
    private readonly maxDelayMs = 60_000;

    public nextDelayMs(attemptNumber: number): number
    {
        const exponential = Math.min(this.baseDelayMs * 2 ** (attemptNumber - 1), this.maxDelayMs);
        return Math.floor(exponential / 2 + Math.random() * (exponential / 2));
    }

    public isExhausted(transaction: WagerTransaction, now: Date): boolean
    {
        return transaction.ageMs(now) > this.ttlMs || transaction.referenceAttempts + 1 >= this.maxAttempts;
    }
}