import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { v7 as uuidv7 } from "uuid";

import { WalletNotFoundError } from "../../src/application/errors";
import { WagerTransactionKind } from "../../src/domain/wager/wager-transaction.types";

import { createTestContext, type TestContext } from "../support/test-context";


describe("Integração: reconciliação contábil", () =>
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

    const sql = (query: string, params: unknown[] = []) => ctx.orm.em.fork().execute(query, params);

    it("Após operações mistas (BET, WIN, LOSS, REFUND), saldo e ledger são consistentes", async () =>
    {
        const playerId = uuidv7();
        const provider = `prov-rec-${uuidv7()}`;
        const wallet = await ctx.openWallet.execute({ playerId, initialBalance: { amount: "100.00", currency: "BRL" } });
        const base = { providerId: provider, playerId, walletId: wallet.id, roundId: "r", gameId: "g", idempotencyKey: "" };
        const betExt = `bet-${uuidv7()}`;

        await ctx.processWager.execute({ ...base, idempotencyKey: `k1-${uuidv7()}`, externalTransactionId: betExt, kind: WagerTransactionKind.Bet,money: { amount: "40.00", currency: "BRL" } });
        await ctx.processWager.execute({ ...base, idempotencyKey: `k2-${uuidv7()}`, externalTransactionId: `win-${uuidv7()}`, kind: WagerTransactionKind.Win, money: { amount: "70.00", currency: "BRL" } });
        await ctx.processWager.execute({ ...base, idempotencyKey: `k3-${uuidv7()}`, externalTransactionId: `loss-${uuidv7()}`, kind: WagerTransactionKind.Loss, money: { amount: "5.00", currency: "BRL" } });
        await ctx.processWager.execute({ ...base, idempotencyKey: `k4-${uuidv7()}`, externalTransactionId: `rf-${uuidv7()}`, kind: WagerTransactionKind.Refund, money: { amount: "40.00", currency: "BRL" }, referenceExternalTransactionId: betExt });

        const rec = await ctx.reconcile.execute(wallet.id);

        expect(rec.consistent).toBe(true);
        expect(rec.storedBalance.amount).toBe("170.00");
        expect(rec.calculatedBalance.amount).toBe("170.00");
        expect(rec.difference.amount).toBe("0.00");
        expect(rec.checkedEntries).toBe(4);
    });

    it("Divergência entre saldo e ledger é sinalizada, registrada em log e NÃO é corrigida", async () =>
    {
        const playerId = uuidv7();
        const wallet = await ctx.openWallet.execute({ playerId, initialBalance: { amount: "100.00", currency: "BRL" } });

        await sql("update wallets set balance = 999.00 where id = ?", [wallet.id]);

        const rec = await ctx.reconcile.execute(wallet.id);

        expect(rec.consistent).toBe(false);
        expect(rec.storedBalance.amount).toBe("999.00");
        expect(rec.calculatedBalance.amount).toBe("100.00");
        expect(rec.difference.amount).toBe("899.00");
        expect(ctx.logger.entries.some((e) => e.level === "error" && e.message.includes("Divergência"))).toBe(true);

        const [stored] = await sql("select balance from wallets where id = ?", [wallet.id]);
        expect(Number(stored?.balance ?? 0)).toBe(999);
    });

    it("Reconciliar wallet inexistente retorna WalletNotFoundError", async () =>
    {
        await expect(ctx.reconcile.execute(uuidv7())).rejects.toThrow(WalletNotFoundError);
    });
});
