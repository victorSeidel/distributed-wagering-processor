import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { v7 as uuidv7 } from "uuid";

import { DuplicateExternalTransactionError, IdempotencyConflictError } from "../../src/application/errors";
import { WagerFailureCode, WagerTransactionKind, WagerTransactionStatus } from "../../src/domain/wager/wager-transaction.types";
import { createTestContext, type TestContext } from "../support/test-context";

describe("Integração: idempotência", () =>
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

    async function openWallet(balance: string)
    {
        return ctx.openWallet.execute({ playerId: uuidv7(), initialBalance: { amount: balance, currency: "BRL" } });
    }

    function bet(walletId: string, playerId: string, externalTransactionId: string, idempotencyKey: string, amount: string, kind = WagerTransactionKind.Bet)
    {
        return {
            providerId: "provider-idem",
            externalTransactionId,
            idempotencyKey,
            playerId,
            walletId,
            roundId: "round-idem",
            gameId: "game-idem",
            kind,
            money: { amount, currency: "BRL" },
        };
    }

    it("Mesma Idempotency-Key com payload diferente é conflito (409), nunca replay", async () =>
    {
        const wallet = await openWallet("100.00");
        const key = `key-${uuidv7()}`;

        await ctx.processWager.execute(bet(wallet.id, wallet.playerId, `ext-${uuidv7()}`, key, "10.00"));

        await expect(ctx.processWager.execute(bet(wallet.id, wallet.playerId, `ext-${uuidv7()}`, key, "11.00")))
            .rejects.toThrow(IdempotencyConflictError);

        const current = await ctx.getWallet.execute(wallet.id);
        expect(current.balance.amount).toBe("90.00");
    });

    it("Mesma transação externa do provedor com outra chave é rejeitada e não debita novamente", async () =>
    {
        const wallet = await openWallet("100.00");
        const external = `ext-${uuidv7()}`;

        await ctx.processWager.execute(bet(wallet.id, wallet.playerId, external, `k1-${uuidv7()}`, "10.00"));

        await expect(ctx.processWager.execute(bet(wallet.id, wallet.playerId, external, `k2-${uuidv7()}`, "10.00")))
            .rejects.toThrow(DuplicateExternalTransactionError);

        const current = await ctx.getWallet.execute(wallet.id);
        expect(current.balance.amount).toBe("90.00");
    });

    it("Replay devolve o saldo ORIGINAL da transação, mesmo após movimentos posteriores", async () =>
    {
        const wallet = await openWallet("100.00");
        const original = bet(wallet.id, wallet.playerId, `ext-${uuidv7()}`, `key-${uuidv7()}`, "10.00");

        const first = await ctx.processWager.execute(original);
        expect(first.balance.amount).toBe("90.00");

        await ctx.processWager.execute(bet(wallet.id, wallet.playerId, `ext-${uuidv7()}`, `key-${uuidv7()}`, "20.00"));

        const replay = await ctx.processWager.execute(original);
        expect(replay.idempotentReplay).toBe(true);
        expect(replay.transactionId).toBe(first.transactionId);
        expect(replay.balance.amount).toBe("90.00");
        expect((await ctx.getWallet.execute(wallet.id)).balance.amount).toBe("70.00");
    });

    it("Replay de transação rejeitada devolve a mesma rejeição, sem reavaliar a regra", async () =>
    {
        const wallet = await openWallet("5.00");
        const original = bet(wallet.id, wallet.playerId, `ext-${uuidv7()}`, `key-${uuidv7()}`, "50.00");

        const rejected = await ctx.processWager.execute(original);
        expect(rejected.status).toBe(WagerTransactionStatus.Rejected);
        expect(rejected.failureCode).toBe(WagerFailureCode.InsufficientFunds);

        const replay = await ctx.processWager.execute(original);
        expect(replay.idempotentReplay).toBe(true);
        expect(replay.status).toBe(WagerTransactionStatus.Rejected);
        expect(replay.failureCode).toBe(WagerFailureCode.InsufficientFunds);
    });

    it("Consulta por provedor e id externo retorna a mesma transação que o id interno", async () =>
    {
        const wallet = await openWallet("100.00");
        const external = `ext-${uuidv7()}`;

        const result = await ctx.processWager.execute(bet(wallet.id, wallet.playerId, external, `key-${uuidv7()}`, "10.00"));

        const byId = await ctx.getTransaction.byId(result.transactionId);
        const byExternal = await ctx.getTransaction.byExternalId("provider-idem", external);

        expect(byExternal.id).toBe(byId.id);
        expect(byId.balanceAfter?.amount).toBe("90.00");
    });
});
