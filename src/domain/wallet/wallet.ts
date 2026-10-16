import { Money } from "../shared/money";
import { CurrencyMismatchError, InsufficientFundsError, InvalidInputError, InvalidTransactionStateError } from "../shared/errors";
import { LedgerDirection } from "./ledger-direction";
import { WalletLedgerEntry } from "./wallet-ledger-entry";

export interface OpenWalletProps
{
    id: string;
    playerId: string;
    initialBalance: Money;
}

export interface WalletState
{
    id: string;
    playerId: string;
    currency: string;
    balance: Money;
    version: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface WalletMovement
{
    entryId: string;
    transactionId: string;
    amount: Money;
    at?: Date;
}

export class Wallet
{
    private constructor(
        public readonly id: string,
        public readonly playerId: string,
        public readonly currency: string,
        private _balance: Money,
        private _version: number,
        public readonly createdAt: Date,
        private _updatedAt: Date,
    ) {}

    public static open(props: OpenWalletProps): Wallet
    {
        const now = new Date();
        return new Wallet(props.id, props.playerId, props.initialBalance.currency, props.initialBalance, 1, now, now);
    }

    public static rehydrate(state: WalletState): Wallet
    {
        return new Wallet(state.id, state.playerId, state.currency, state.balance, state.version, state.createdAt, state.updatedAt);
    }

    public get balance(): Money { return this._balance; }
    public get version(): number { return this._version; }
    public get updatedAt(): Date { return this._updatedAt; }

    public openingEntry(entryId: string, transactionId: string): WalletLedgerEntry
    {
        if (this._version !== 1) throw new InvalidTransactionStateError("O lançamento de abertura só pode ser gerado na criação da wallet");

        return WalletLedgerEntry.create({
            id: entryId,
            walletId: this.id,
            transactionId,
            direction: LedgerDirection.Credit,
            money: this._balance,
            balanceBefore: Money.zero(this.currency),
            balanceAfter: this._balance,
            createdAt: this.createdAt,
        });
    }

    public canDebit(amount: Money): boolean
    {
        this.assertSameCurrency(amount);
        return !this._balance.isLessThan(amount);
    }

    public debit(movement: WalletMovement): WalletLedgerEntry
    {
        this.assertMovable(movement.amount);
        if (!this.canDebit(movement.amount)) throw new InsufficientFundsError("Saldo insuficiente para efetuar o débito.");
        return this.apply(LedgerDirection.Debit, this._balance.subtract(movement.amount), movement);
    }

    public credit(movement: WalletMovement): WalletLedgerEntry
    {
        this.assertMovable(movement.amount);
        return this.apply(LedgerDirection.Credit, this._balance.add(movement.amount), movement);
    }

    private apply(direction: LedgerDirection, balanceAfter: Money, movement: WalletMovement): WalletLedgerEntry
    {
        const at = movement.at ?? new Date();

        const entry = WalletLedgerEntry.create({
            id: movement.entryId,
            walletId: this.id,
            transactionId: movement.transactionId,
            direction,
            money: movement.amount,
            balanceBefore: this._balance,
            balanceAfter,
            createdAt: at,
        });

        this._balance = balanceAfter;
        this._version += 1;
        this._updatedAt = at;

        return entry;
    }

    private assertMovable(amount: Money): void
    {
        this.assertSameCurrency(amount);
        if (!amount.isPositive()) throw new InvalidInputError("A movimentação da wallet exige valor positivo");
    }

    private assertSameCurrency(money: Money): void
    {
        if (this.currency !== money.currency) throw new CurrencyMismatchError(money.currency, this.currency);
    }
}