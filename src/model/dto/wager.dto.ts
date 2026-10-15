import type { Money } from "../../domain/common/money";
import type { Money as MoneyType } from "../type/money.type";

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

export interface SubmitWagerTransactionDto
{
    providerId: string;
    externalTransactionId: string;
    playerId: string;
    walletId: string;
    roundId: string;
    gameId: string;
    kind: WagerTransactionKind;
    money: MoneyType;
    referenceExternalTransactionId?: string;
}

export interface SubmitWagerTransactionResponseDto
{
    transactionId: string;
    status: WagerTransactionStatus;
    balance: MoneyType;
    idempotentReplay: boolean;
    failureCode?: WagerFailureCode;
}

export interface WagerReconciliationResponseDto
{
    walletId: string;
    storedBalance: MoneyType;
    calculatedBalance: MoneyType;
    difference: MoneyType;
    consistent: boolean;
    checkedEntries: number;
}