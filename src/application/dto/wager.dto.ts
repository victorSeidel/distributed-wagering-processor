import type { MoneyProps } from "../../domain/shared/money";
import type { WagerFailureCode, WagerTransactionKind, WagerTransactionStatus } from "../../domain/wager/wager-transaction.types";
import type { Channel } from "../ports/observability.port";

export interface ProcessWagerCommand
{
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    playerId: string;
    walletId: string;
    roundId: string;
    gameId: string;
    kind: WagerTransactionKind;
    money: MoneyProps;
    referenceExternalTransactionId?: string;
    correlationId?: string;
}

export interface ProcessWagerResult
{
    transactionId: string;
    status: WagerTransactionStatus;
    balance: MoneyProps;
    idempotentReplay: boolean;
    failureCode?: WagerFailureCode;
}

export interface InboxContext
{
    consumerName: string;
    messageId: string;
    payloadHash: string;
}

export interface ProcessWagerOptions
{
    channel: Channel;
    inbox?: InboxContext;
}

export interface WagerTransactionResponse
{
    id: string;
    providerId: string;
    externalTransactionId: string;
    walletId: string;
    playerId: string;
    roundId: string;
    gameId: string;
    kind: WagerTransactionKind;
    money: MoneyProps;
    status: WagerTransactionStatus;
    failureCode?: WagerFailureCode;
    referenceExternalTransactionId?: string;
    referenceTransactionId?: string;
    balanceAfter?: MoneyProps;
    createdAt: string;
    processedAt?: string;
}