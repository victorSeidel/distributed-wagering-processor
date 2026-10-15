import { describe, expect, it } from "bun:test";

import { Money } from "../../src/domain/common/money";

describe("Money Value Object", () =>
{
    it("Deve criar valor monetário com escala fixa de 2 casas", () =>
    {
        const m = Money.from({ amount: "25.50", currency: "BRL" });
        expect(m.toString()).toBe("25.50");
        expect(m.currency).toBe("BRL");
    });

    it("Deve somar valores monetários corretamente", () =>
    {
        const a = Money.from({ amount: "10.25", currency: "BRL" });
        const b = Money.from({ amount: "20.75", currency: "BRL" });
        const sum = a.add(b);
        expect(sum.toString()).toBe("31.00");
    });

    it("Deve subtrair valores monetários corretamente", () =>
    {
        const a = Money.from({ amount: "100.00", currency: "BRL" });
        const b = Money.from({ amount: "40.50", currency: "BRL" });
        const diff = a.subtract(b);
        expect(diff.toString()).toBe("59.50");
    });

    it("Não deve sofrer do erro clássico do IEEE-754", () =>
    {
        const a = Money.from({ amount: "0.10", currency: "BRL" });
        const b = Money.from({ amount: "0.20", currency: "BRL" });
        expect(a.add(b).toString()).toBe("0.30");
    });

    it("Deve rejeitar entradas com mais de 2 casas decimais", () =>
    {
        expect(() => Money.from({ amount: "10.999", currency: "BRL" })).toThrow();
    });

    it("Deve rejeitar valores com notação científica ou strings inválidas", () =>
    {
        expect(() => Money.from({ amount: "1e5", currency: "BRL" })).toThrow();
        expect(() => Money.from({ amount: "invalid", currency: "BRL" })).toThrow();
        expect(() => Money.from({ amount: "", currency: "BRL" })).toThrow();
    });

    it("Deve estourar erro ao tentar somar moedas diferentes", () =>
    {
        const brl = Money.from({ amount: "10.00", currency: "BRL" });
        const usd = Money.from({ amount: "10.00", currency: "USD" });
        expect(() => brl.add(usd)).toThrow("Conflito de moedas");
    });
});