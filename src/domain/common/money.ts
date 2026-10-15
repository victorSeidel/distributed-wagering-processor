import Decimal from "decimal.js";
import type { Money as MoneyType } from "../../model/type/money.type";
import { CurrencyConflictError, InvalidInputError } from "./errors";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export class Money
{
    private constructor(
        private readonly value: Decimal,
        public readonly currency: string
    ) {}

    public static from(props: MoneyType): Money
    {
        const { amount, currency } = props;

        if (typeof currency !== "string" || currency.trim().length !== 3) throw new InvalidInputError(`Moeda inválida: ${currency}. Deve ser ISO-4217`);
        if (typeof amount !== "string" || !amount.trim()) throw new InvalidInputError("Amount monetário deve ser uma string não vazia");

        const decimalPattern = /^\d+(\.\d{1,2})?$/;
        if (!decimalPattern.test(amount.trim())) throw new InvalidInputError(`Formato inválido para amount: "${amount}". Requer string decimal positiva com até 2 casas`);

        let parsed: Decimal;
        try
        {
            parsed = new Decimal(amount);
        }
        catch
        {
            throw new InvalidInputError(`Falha ao instanciar Decimal a partir de "${amount}"`);
        }

        if (!parsed.isFinite()) throw new InvalidInputError("Valores monetários não podem ser NaN ou Infinity.");

        return new Money(parsed, currency.toUpperCase());
    }

    public static fromDecimalInternal(value: Decimal, currency: string): Money
    {
        return new Money(value, currency);
    }

    public static zero(currency: string): Money
    {
        return new Money(new Decimal(0), currency.toUpperCase());
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
        return this.value.isNegative();
    }

    public isLessThan(other: Money): boolean
    {
        this.assertSameCurrency(other);
        return this.value.lessThan(other.value);
    }

    public isGreaterThan(other: Money): boolean
    {
        this.assertSameCurrency(other);
        return this.value.greaterThan(other.value);
    }

    public equals(other: Money): boolean
    {
        return this.currency === other.currency && this.value.equals(other.value);
    }

    public toJSON(): MoneyType
    {
        return {
            amount: this.toString(),
            currency: this.currency,
        };
    }

    public toString(): string
    {
        return this.value.toFixed(2);
    }

    public toDecimal(): Decimal
    {
        return this.value;
    }

    private assertSameCurrency(other: Money): void 
    {
        if (this.currency !== other.currency) throw new CurrencyConflictError(`Conflito de moedas: operação entre ${this.currency} e ${other.currency}.`);
    }
}