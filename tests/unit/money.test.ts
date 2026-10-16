import { describe, expect, it } from "bun:test";

import { Money } from "../../src/domain/shared/money";
import { CurrencyConflictError, InvalidInputError } from "../../src/domain/shared/errors";

describe("Money Value Object", () =>
{
    it("Deve criar valor monetário com escala fixa de 2 casas", () =>
    {
        const m = Money.from({ amount: "25.50", currency: "BRL" });
        expect(m.toString()).toBe("25.50");
        expect(m.currency).toBe("BRL");
    });

    it("Deve normalizar valor inteiro e de 1 casa para 2 casas", () =>
    {
        expect(Money.from({ amount: "5", currency: "BRL" }).toString()).toBe("5.00");
        expect(Money.from({ amount: "0.1", currency: "BRL" }).toString()).toBe("0.10");
    });

    it("Deve normalizar a moeda para maiúsculas", () =>
    {
        expect(Money.from({ amount: "1.00", currency: "brl" }).currency).toBe("BRL");
    });

    it("Não deve sofrer do erro clássico do IEEE-754", () =>
    {
        const a = Money.from({ amount: "0.10", currency: "BRL" });
        const b = Money.from({ amount: "0.20", currency: "BRL" });
        expect(a.add(b).toString()).toBe("0.30");
    });

    it("Deve somar e subtrair mantendo a escala de 2 casas", () =>
    {
        const a = Money.from({ amount: "100.00", currency: "BRL" });
        expect(a.subtract(Money.from({ amount: "40.50", currency: "BRL" })).toString()).toBe("59.50");
        expect(a.add(Money.from({ amount: "0.01", currency: "BRL" })).toString()).toBe("100.01");
    });

    it("Deve rejeitar entradas com mais de 2 casas decimais", () =>
    {
        expect(() => Money.from({ amount: "10.999", currency: "BRL" })).toThrow(InvalidInputError);
    });

    it("Deve rejeitar notação científica, NaN, Infinity e strings inválidas", () =>
    {
        for (const amount of ["1e5", "NaN", "Infinity", "-Infinity", "invalid", "", "   "])
            expect(() => Money.from({ amount, currency: "BRL" })).toThrow(InvalidInputError);
    });

    it("Deve rejeitar valores negativos em contratos de entrada", () =>
    {
        expect(() => Money.from({ amount: "-0.01", currency: "BRL" })).toThrow(InvalidInputError);
    });

    it("Deve aceitar valores negativos apenas no modo diagnóstico (reconciliação)", () =>
    {
        expect(Money.fromSigned({ amount: "-5.00", currency: "BRL" }).toString()).toBe("-5.00");
    });

    it("Deve rejeitar moeda fora do formato ISO-4217", () =>
    {
        expect(() => Money.from({ amount: "1.00", currency: "BR" })).toThrow(InvalidInputError);
        expect(() => Money.from({ amount: "1.00", currency: "B1L" })).toThrow(InvalidInputError);
    });

    it("Deve lançar erro de conflito ao operar moedas diferentes", () =>
    {
        const brl = Money.from({ amount: "10.00", currency: "BRL" });
        const usd = Money.from({ amount: "10.00", currency: "USD" });
        expect(() => brl.add(usd)).toThrow(CurrencyConflictError);
        expect(() => brl.isLessThan(usd)).toThrow(CurrencyConflictError);
    });

    it("Deve ser imutável: operações devolvem novas instâncias", () =>
    {
        const a = Money.from({ amount: "10.00", currency: "BRL" });
        const b = a.add(Money.from({ amount: "5.00", currency: "BRL" }));
        expect(a.toString()).toBe("10.00");
        expect(b).not.toBe(a);
    });

    it("Deve serializar para o formato de contrato e comparar por valor", () =>
    {
        const m = Money.from({ amount: "25.00", currency: "BRL" });
        expect(m.toJSON()).toEqual({ amount: "25.00", currency: "BRL" });
        expect(m.equals(Money.from({ amount: "25", currency: "BRL" }))).toBe(true);
        expect(m.equals(Money.from({ amount: "25.00", currency: "USD" }))).toBe(false);
    });
});
