import type { MoneyProps } from "../shared/money";
import type { LedgerDirection } from "../wallet/ledger-direction";
import type { Wallet } from "../wallet/wallet";
import type { WalletLedgerEntry } from "../wallet/wallet-ledger-entry";
import { IntegrationEvent, type EventContext } from "./integration-event";

export interface WalletBalanceChangedData
{
    walletId: string;
    transactionId: string;
    direction: LedgerDirection;
    money: MoneyProps;
    balanceBefore: MoneyProps;
    balanceAfter: MoneyProps;
    walletVersion: number;
}

export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData>
{
    readonly eventType = "WalletBalanceChanged";
    readonly version = 1;

    public static from(wallet: Wallet, entry: WalletLedgerEntry, context: EventContext): WalletBalanceChanged
    {
        return new WalletBalanceChanged({
            aggregateId: wallet.id,
            correlationId: context.correlationId,
            causationId: context.causationId,
            data: {
                walletId: wallet.id,
                transactionId: entry.transactionId,
                direction: entry.direction,
                money: entry.money.toJSON(),
                balanceBefore: entry.balanceBefore.toJSON(),
                balanceAfter: entry.balanceAfter.toJSON(),
                walletVersion: wallet.version,
            },
        });
    }
}