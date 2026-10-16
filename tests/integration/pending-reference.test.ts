import { describe, expect, it, beforeAll, afterAll } from "bun:test";

import { v7 as uuidv7 } from "uuid";

import { createTestContext, type TestContext } from "../support/test-context";

import { WagerFailureCode, WagerTransactionKind, WagerTransactionStatus } from "../../src/domain/wager/wager-transaction.types";

describe("Integração: referências fora de ordem (PENDING_REFERENCE)", () =>
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

    async function drain(): Promise<void>
    {
        while (await ctx.processPending.execute()) {}
    }

    function command(walletId: string, playerId: string, providerId: string, externalTransactionId: string, kind: WagerTransactionKind, amount: string, ref?: string, roundId = "round-ooo")
    {
        return {
            providerId,
            externalTransactionId,
            idempotencyKey: `key-${externalTransactionId}`,
            playerId,
            walletId,
            roundId,
            gameId: "game-ooo",
            kind,
            money: { amount, currency: "BRL" },
            referenceExternalTransactionId: ref,
        };
    }

    it("ROLLBACK de WIN que chega antes do WIN: fica pendente e é revertido ao chegar a referência", async () =>
    {
        const playerId = uuidv7();
        const provider = `prov-rb-${uuidv7()}`;
        const wallet = await ctx.openWallet.execute({ playerId, initialBalance: { amount: "100.00", currency: "BRL" } });
        const winId = `win-${uuidv7()}`;

        const rbExternal = `rb-${uuidv7()}`;
        const rollback = await ctx.processWager.execute(command(wallet.id, playerId, provider, rbExternal, WagerTransactionKind.Rollback, "30.00", winId));
        expect(rollback.status).toBe(WagerTransactionStatus.PendingReference);
        expect(rollback.balance.amount).toBe("100.00");

        await ctx.processWager.execute(command(wallet.id, playerId, provider, winId, WagerTransactionKind.Win, "30.00"));
        expect((await ctx.getWallet.execute(wallet.id)).balance.amount).toBe("130.00");

        await drain();

        const resolved = await ctx.getTransaction.byExternalId(provider, rbExternal);
        expect(resolved.status).toBe(WagerTransactionStatus.Processed);
        expect((await ctx.getWallet.execute(wallet.id)).balance.amount).toBe("100.00");
    });

    it("REFUND de BET que chega depois: credita exatamente uma vez, mesmo com drenagem repetida", async () =>
    {
        const playerId = uuidv7();
        const provider = `prov-rf-${uuidv7()}`;
        const wallet = await ctx.openWallet.execute({ playerId, initialBalance: { amount: "20.00", currency: "BRL" } });
        const betId = `bet-${uuidv7()}`;

        const refund = await ctx.processWager.execute(command(wallet.id, playerId, provider, `rf-${uuidv7()}`, WagerTransactionKind.Refund, "30.00", betId));
        expect(refund.status).toBe(WagerTransactionStatus.PendingReference);

        await ctx.processWager.execute(command(wallet.id, playerId, provider, betId, WagerTransactionKind.Bet, "30.00"));
        await drain();
        await drain();

        expect((await ctx.getWallet.execute(wallet.id)).balance.amount).toBe("20.00");
    });

    it("Tentativa sem referência agenda a próxima com backoff e não é reprocessada imediatamente", async () =>
    {
        const playerId = uuidv7();
        const provider = `prov-bo-${uuidv7()}`;
        const wallet = await ctx.openWallet.execute({ playerId, initialBalance: { amount: "20.00", currency: "BRL" } });
        const external = `rf-bo-${uuidv7()}`;

        const refund = await ctx.processWager.execute(command(wallet.id, playerId, provider, external, WagerTransactionKind.Refund, "5.00", `never-${uuidv7()}`));
        await drain();

        const [row] = await sql("select status, reference_attempts, reference_next_attempt_at from wager_transactions where id = ?", [refund.transactionId]);
        expect(row?.status).toBe(WagerTransactionStatus.PendingReference);
        expect(row?.reference_attempts).toBe(1);
        expect(new Date(row?.reference_next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    });

    it("Referência que nunca chega: após o TTL vira REJECTED REFERENCE_NOT_FOUND e publica o evento", async () =>
    {
        const playerId = uuidv7();
        const provider = `prov-ttl-${uuidv7()}`;
        const wallet = await ctx.openWallet.execute({ playerId, initialBalance: { amount: "20.00", currency: "BRL" } });
        const external = `rf-ttl-${uuidv7()}`;

        const refund = await ctx.processWager.execute(command(wallet.id, playerId, provider, external, WagerTransactionKind.Refund, "5.00", `never-${uuidv7()}`));

        await sql("update wager_transactions set created_at = now() - interval '10 minutes', reference_next_attempt_at = null where id = ?", [refund.transactionId]);
        await drain();

        const [row] = await sql("select status, failure_code from wager_transactions where id = ?", [refund.transactionId]);
        expect(row?.status).toBe(WagerTransactionStatus.Rejected);
        expect(row?.failure_code).toBe(WagerFailureCode.ReferenceNotFound);

        const [event] = await sql("select count(*)::int as c from outbox_messages where aggregate_id = ? and event_type = 'WagerTransactionRejected'", [refund.transactionId]);
        expect(event?.c).toBe(1);
        expect((await ctx.getWallet.execute(wallet.id)).balance.amount).toBe("20.00");
    });

    it("Referência existente porém REJECTED no momento da submissão: REFERENCE_NOT_PROCESSED, sem crédito", async () =>
    {
        const playerId = uuidv7();
        const provider = `prov-nr-${uuidv7()}`;
        const wallet = await ctx.openWallet.execute({ playerId, initialBalance: { amount: "10.00", currency: "BRL" } });
        const betId = `bet-nr-${uuidv7()}`;

        const rejectedBet = await ctx.processWager.execute(command(wallet.id, playerId, provider, betId, WagerTransactionKind.Bet, "50.00"));
        expect(rejectedBet.failureCode).toBe(WagerFailureCode.InsufficientFunds);

        const refund = await ctx.processWager.execute(command(wallet.id, playerId, provider, `rf-nr-${uuidv7()}`, WagerTransactionKind.Refund, "50.00", betId));
        expect(refund.status).toBe(WagerTransactionStatus.Rejected);
        expect(refund.failureCode).toBe(WagerFailureCode.ReferenceNotProcessed);
        expect((await ctx.getWallet.execute(wallet.id)).balance.amount).toBe("10.00");
    });
});
