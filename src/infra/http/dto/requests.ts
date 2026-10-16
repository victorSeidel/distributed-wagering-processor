import type { MoneyProps } from "../../../domain/shared/money";
import type { WagerTransactionKind } from "../../../domain/wager/wager-transaction.types";

export interface CreateWalletRequest
{
    playerId: string;
    initialBalance: MoneyProps;
}

export interface SubmitWagerTransactionRequest
{
    providerId: string;
    externalTransactionId: string;
    playerId: string;
    walletId: string;
    roundId: string;
    gameId: string;
    kind: WagerTransactionKind;
    money: MoneyProps;
    referenceExternalTransactionId?: string;
}