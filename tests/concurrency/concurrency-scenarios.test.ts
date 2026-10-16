import { describe, expect, it, beforeAll, afterAll } from "bun:test";

import { v7 as uuidv7 } from "uuid";

import { createTestContext, type TestContext, RecordingPublisher } from "../support/test-context";

import { WagerTransactionKind, WagerTransactionStatus } from "../../src/domain/wager/wager-transaction.types";

describe("Cenários Avançados de Concorrência e Mensageria", () =>
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

    async function drain(): Promise<void>
    {
        while (await ctx.processPending.execute()) {}
    }

    it("Wallets distintas processadas em paralelo não devem se bloquear", async () =>
    {
        const numWallets = 10;
        const wallets = await Promise.all(
            Array.from({ length: numWallets }, (_, i) =>
                ctx.openWallet.execute({ playerId: `player-distinct-${i}-${uuidv7()}`, initialBalance: { amount: "100.00", currency: "BRL" } })
            )
        );

        const bets = wallets.map((w) =>
            ctx.processWager.execute({
                providerId: "provider-parallel",
                externalTransactionId: `bet-${w.id}`,
                idempotencyKey: `idemp-${w.id}`,
                playerId: w.playerId,
                walletId: w.id,
                roundId: "r-parallel",
                gameId: "g-parallel",
                kind: WagerTransactionKind.Bet,
                money: { amount: "15.00", currency: "BRL" },
            })
        );

        const results = await Promise.all(bets);

        for (const res of results)
        {
            expect(res.status).toBe(WagerTransactionStatus.Processed);
            expect(res.balance.amount).toBe("85.00");
        }

        for (const w of wallets)
        {
            const rec = await ctx.reconcile.execute(w.id);
            expect(rec.consistent).toBe(true);
            expect(rec.storedBalance.amount).toBe("85.00");
            expect(rec.calculatedBalance.amount).toBe("85.00");
        }
    });

    it("Dois publishers concorrentes sobre a mesma outbox (SKIP LOCKED)", async () =>
    {
        const publisherA = new RecordingPublisher();
        const publisherB = new RecordingPublisher();

        const ctxA = await createTestContext(publisherA);
        const ctxB = await createTestContext(publisherB);

        const playerId = uuidv7();
        const wallet = await ctxA.openWallet.execute({ playerId, initialBalance: { amount: "500.00", currency: "BRL" } });

        for (let i = 0; i < 10; i++)
        {
            await ctxA.processWager.execute({
                providerId: "p-outbox",
                externalTransactionId: `tx-outbox-${i}-${uuidv7()}`,
                idempotencyKey: `k-outbox-${i}-${uuidv7()}`,
                playerId,
                walletId: wallet.id,
                roundId: `round-${i}`,
                gameId: "slot",
                kind: WagerTransactionKind.Bet,
                money: { amount: "1.00", currency: "BRL" },
            });
        }

        await Promise.all([ctxA.publishOutbox.execute(), ctxB.publishOutbox.execute()]);

        const idsA = publisherA.published.map((m) => m.id);
        const idsB = publisherB.published.map((m) => m.id);

        const intersection = idsA.filter((id) => idsB.includes(id));
        expect(intersection).toEqual([]);

        await ctxA.close();
        await ctxB.close();
    });

    it("ROLLBACK / REFUND entregue antes da referência (Out-of-order)", async () =>
    {
        const playerId = uuidv7();
        const wallet = await ctx.openWallet.execute({ playerId, initialBalance: { amount: "100.00", currency: "BRL" } });
        const refundExternalId = `refund-${uuidv7()}`; 
        const betExternalId = `bet-target-${uuidv7()}`;

        const refundRes = await ctx.processWager.execute({
            providerId: "provider-order",
            externalTransactionId: refundExternalId ,
            idempotencyKey: `idemp-refund-${uuidv7()}`,
            playerId,
            walletId: wallet.id,
            roundId: "round-order",
            gameId: "roulette",
            kind: WagerTransactionKind.Refund,
            money: { amount: "30.00", currency: "BRL" },
            referenceExternalTransactionId: betExternalId,
        });

        expect(refundRes.status).toBe(WagerTransactionStatus.PendingReference);
        expect(refundRes.balance.amount).toBe("100.00");

        const betRes = await ctx.processWager.execute({
            providerId: "provider-order",
            externalTransactionId: betExternalId,
            idempotencyKey: `idemp-bet-${uuidv7()}`,
            playerId,
            walletId: wallet.id,
            roundId: "round-order",
            gameId: "roulette",
            kind: WagerTransactionKind.Bet,
            money: { amount: "30.00", currency: "BRL" },
        });

        expect(betRes.status).toBe(WagerTransactionStatus.Processed);
        expect(betRes.balance.amount).toBe("70.00");

        await drain();

        const rec = await ctx.reconcile.execute(wallet.id);
        expect(rec.consistent).toBe(true);
        expect(rec.storedBalance.amount).toBe("100.00");
        expect(rec.calculatedBalance.amount).toBe("100.00");
    });

    it("Reinício a frio do serviço e comprovação da consistência contábil", async () =>
    {
        const playerId = uuidv7();
        const wallet = await ctx.openWallet.execute({ playerId, initialBalance: { amount: "200.00", currency: "BRL" } });

        await ctx.processWager.execute({
            providerId: "p-restart",
            externalTransactionId: `tx-pre-restart-${uuidv7()}`,
            idempotencyKey: `k-pre-${uuidv7()}`,
            playerId,
            walletId: wallet.id,
            roundId: "round-restart",
            gameId: "game-restart",
            kind: WagerTransactionKind.Bet,
            money: { amount: "50.00", currency: "BRL" },
        });

        await ctx.close();

        const newCtx = await createTestContext();

        const recBefore = await newCtx.reconcile.execute(wallet.id);
        expect(recBefore.consistent).toBe(true);
        expect(recBefore.storedBalance.amount).toBe("150.00");

        const postRestartRes = await newCtx.processWager.execute({
            providerId: "p-restart",
            externalTransactionId: `tx-post-restart-${uuidv7()}`,
            idempotencyKey: `k-post-${uuidv7()}`,
            playerId,
            walletId: wallet.id,
            roundId: "round-restart",
            gameId: "game-restart",
            kind: WagerTransactionKind.Win,
            money: { amount: "100.00", currency: "BRL" },
        });

        expect(postRestartRes.status).toBe(WagerTransactionStatus.Processed);
        expect(postRestartRes.balance.amount).toBe("250.00");

        const recAfter = await newCtx.reconcile.execute(wallet.id);
        expect(recAfter.consistent).toBe(true);
        expect(recAfter.storedBalance.amount).toBe("250.00");
        expect(recAfter.calculatedBalance.amount).toBe("250.00");

        await newCtx.close();
        ctx = await createTestContext();
    });
});