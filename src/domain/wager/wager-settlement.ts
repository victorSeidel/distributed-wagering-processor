import type { Wallet } from "../wallet/wallet";
import type { WalletLedgerEntry } from "../wallet/wallet-ledger-entry";
import { LedgerDirection } from "../wallet/ledger-direction";
import type { WagerTransaction } from "./wager-transaction";
import { WagerFailureCode, WagerTransactionKind } from "./wager-transaction.types";

export interface SettlementInput
{
    wallet: Wallet;
    transaction: WagerTransaction;
    reference?: WagerTransaction;
    referenceAlreadyReversed: boolean;
    ledgerEntryId: string;
    at: Date;
}

export type SettlementResult =
    | { type: "AWAITING_REFERENCE" }
    | { type: "REJECTED"; failureCode: WagerFailureCode }
    | { type: "PROCESSED"; ledgerEntry?: WalletLedgerEntry };

export class WagerSettlement
{
    public static apply(input: SettlementInput): SettlementResult
    {
        const { wallet, transaction, reference, at } = input;

        if (wallet.playerId !== transaction.playerId) return WagerSettlement.reject(wallet, transaction, WagerFailureCode.PlayerMismatch, at);

        if (transaction.requiresReference())
        {
            if (!reference || transaction.isReferenceUnresolved(reference)) return { type: "AWAITING_REFERENCE" };

            const referenceFailure = transaction.evaluateReference(reference);
            if (referenceFailure) return WagerSettlement.reject(wallet, transaction, referenceFailure, at);

            if (input.referenceAlreadyReversed) return WagerSettlement.reject(wallet, transaction, WagerFailureCode.ReferenceAlreadyReversed, at);
        }

        let ledgerEntry: WalletLedgerEntry | undefined;

        if (transaction.affectsBalance())
        {
            const movement = { entryId: input.ledgerEntryId, transactionId: transaction.id, amount: transaction.money, at };

            if (transaction.ledgerDirectionFor(reference) === LedgerDirection.Debit)
            {
                if (!wallet.canDebit(transaction.money))
                {
                    const failure = transaction.kind === WagerTransactionKind.Bet
                        ? WagerFailureCode.InsufficientFunds
                        : WagerFailureCode.ReversalWouldProduceNegativeBalance;

                    return WagerSettlement.reject(wallet, transaction, failure, at);
                }

                ledgerEntry = wallet.debit(movement);
            }
            else
            {
                ledgerEntry = wallet.credit(movement);
            }
        }

        transaction.markProcessed(reference?.id, at);
        transaction.recordBalanceAfter(wallet.balance);

        return { type: "PROCESSED", ledgerEntry };
    }

    public static reject(wallet: Wallet, transaction: WagerTransaction, failureCode: WagerFailureCode, at: Date): SettlementResult
    {
        transaction.reject(failureCode, at);
        transaction.recordBalanceAfter(wallet.balance);

        return { type: "REJECTED", failureCode };
    }
}