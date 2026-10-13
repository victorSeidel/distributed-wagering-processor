import type { Money } from "../../domain/common/money";
import type { WagerFailureCode, WagerTransactionStatus, WagerTransactionKind } from "../entity/wager.entity";

export interface CreateWagerTransactionDto
{
    id: string;
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    payloadHash: string;
    walletId: string;
    playerId: string;
    roundId: string;
    gameId: string;
    kind: WagerTransactionKind;
    money: Money;
    referenceExternalTransactionId?: string;
}

export interface WagerTransactionState
{
    id: string;
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    payloadHash: string;
    walletId: string;
    playerId: string;
    roundId: string;
    gameId: string;
    kind: WagerTransactionKind;
    money: Money;
    referenceExternalTransactionId?: string;
    status: WagerTransactionStatus;
    referenceTransactionId?: string;
    failureCode?: WagerFailureCode;
    processedAt?: Date;
    createdAt: Date;
}