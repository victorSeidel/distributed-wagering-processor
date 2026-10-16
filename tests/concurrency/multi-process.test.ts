import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { v7 as uuidv7 } from "uuid";
import { createTestContext, type TestContext } from "../support/test-context";

describe("Concorrência Real: ≥ 3 Processos Bun Independentes", () =>
{
    let ctx: TestContext;

    beforeAll(async () =>
    {
        ctx = await createTestContext();
    });

    afterAll(async () =>
    {
        await ctx.close();
    });

    it("3 instâncias de processos reais disputam saldo de 100.00 BRL com apostas de 40.00 BRL", async () =>
    {
        const playerId = uuidv7();
        const wallet = await ctx.openWallet.execute({ playerId, initialBalance: { amount: "100.00", currency: "BRL" } });

        const p1 = Bun.spawn(["bun", "run", "tests/support/worker-process.ts", wallet.id, playerId, "1"]);
        const p2 = Bun.spawn(["bun", "run", "tests/support/worker-process.ts", wallet.id, playerId, "2"]);
        const p3 = Bun.spawn(["bun", "run", "tests/support/worker-process.ts", wallet.id, playerId, "3"]);

        await Promise.all([p1.exited, p2.exited, p3.exited]);

        const rec = await ctx.reconcile.execute(wallet.id);
        expect(rec.consistent).toBe(true);
        expect(rec.storedBalance.amount).toBe("20.00");
        expect(rec.calculatedBalance.amount).toBe("20.00");
        expect(rec.difference.amount).toBe("0.00");
        expect(rec.checkedEntries).toBe(3);
    });
});