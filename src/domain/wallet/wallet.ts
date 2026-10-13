import type { Money } from "../common/money";

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

    public static open(props: { id: string; playerId: string; initialBalance: Money; }): Wallet
    {
        const now = new Date();
        return new Wallet(
            props.id,
            props.playerId,
            props.initialBalance.currency,
            props.initialBalance,
            1,
            now,
            now
        );
    }

    public static rehydrate(state: WalletState): Wallet
    {
        return new Wallet(
            state.id,
            state.playerId,
            state.currency,
            state.balance,
            state.version,
            state.createdAt,
            state.updatedAt
        );
    }

    public get balance(): Money
    {
        return this._balance;
    }

    public get version(): number
    {
        return this._version;
    }

    public get updatedAt(): Date
    {
        return this._updatedAt;
    }

    public debit(amount: Money): void
    {
        this.assertSameCurrency(amount);

        if (this._balance.isLessThan(amount)) throw new Error("Saldo insuficiente para efetuar o débito.");

        this._balance = this._balance.subtract(amount);
        this._version += 1;
        this._updatedAt = new Date();
    }

    public credit(amount: Money): void
    {
        this.assertSameCurrency(amount);

        this._balance = this._balance.add(amount);
        this._version += 1;
        this._updatedAt = new Date();
    }

    private assertSameCurrency(money: Money): void
    {
        if (this.currency !== money.currency) throw new Error(`Moeda da operação (${money.currency}) incompatível com a carteira (${this.currency}).`);
    }
}