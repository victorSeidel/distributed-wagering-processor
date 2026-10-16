import Decimal from "decimal.js";

import { CurrencyConflictError, InvalidInputError } from "./errors";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export interface MoneyProps
{
    amount: string;
    currency: string;
}

const UNSIGNED_DECIMAL = /^\d+(\.\d{1,2})?$/;
const SIGNED_DECIMAL = /^-?\d+(\.\d{1,2})?$/;

export class Money
{
    private constructor(
        private readonly value: Decimal,
        public readonly currency: string,
    ) {}

    public static from(props: MoneyProps): Money
    {
        return Money.parse(props, UNSIGNED_DECIMAL, "decimal não negativa");
    }

    public static fromSigned(props: MoneyProps): Money
    {
        return Money.parse(props, SIGNED_DECIMAL, "decimal");
    }

    public static zero(currency: string): Money
    {
        return new Money(new Decimal(0), Money.normalizeCurrency(currency));
    }

    public add(other: Money): Money
    {
        this.assertSameCurrency(other);
        return new Money(this.value.plus(other.value), this.currency);
    }

    public subtract(other: Money): Money
    {
        this.assertSameCurrency(other);
        return new Money(this.value.minus(other.value), this.currency);
    }

    public negate(): Money
    {
        return new Money(this.value.negated(), this.currency);
    }

    public isZero(): boolean
    {
        return this.value.isZero();
    }

    public isPositive(): boolean
    {
        return this.value.isPositive() && !this.value.isZero();
    }

    public isNegative(): boolean
    {
        return this.value.isNegative() && !this.value.isZero();
    }

    public isLessThan(other: Money): boolean
    {
        this.assertSameCurrency(other);
        return this.value.lessThan(other.value);
    }

    public equals(other: Money): boolean
    {
        return this.currency === other.currency && this.value.equals(other.value);
    }

    public toJSON(): MoneyProps
    {
        return { amount: this.toString(), currency: this.currency };
    }

    public toString(): string
    {
        return this.value.toFixed(2);
    }

    private static parse(props: MoneyProps, pattern: RegExp, description: string): Money
    {
        const { amount, currency } = props;

        const normalizedCurrency = Money.normalizeCurrency(currency);
        if (typeof amount !== "string" || !amount.trim()) throw new InvalidInputError("Amount monetário deve ser uma string não vazia");

        const trimmed = amount.trim();
        if (!pattern.test(trimmed)) throw new InvalidInputError(`Formato inválido para amount: requer string ${description} com até 2 casas`);

        return new Money(new Decimal(trimmed), normalizedCurrency);
    }

    private static normalizeCurrency(currency: unknown): string
    {
        if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency.trim())) throw new InvalidInputError("Moeda inválida: deve seguir o formato ISO-4217 (3 letras)");
        return currency.trim().toUpperCase();
    }

    private assertSameCurrency(other: Money): void
    {
        if (this.currency !== other.currency) throw new CurrencyConflictError(`Conflito de moedas: operação entre ${this.currency} e ${other.currency}.`);
    }
}