import { describe, expect, it, beforeAll, afterAll } from "bun:test";

import { v7 as uuidv7 } from "uuid";

import { createTestContext, RecordingPublisher, type TestContext } from "../support/test-context";

import { InboxPayloadMismatchError } from "../../src/application/errors";
import { UnitOfWork, type TransactionScope } from "../../src/application/ports/unit-of-work.port";
import { ProcessWagerUseCase } from "../../src/application/usecases/process-wager.usecase";
import { WagerSettlementService } from "../../src/application/services/wager-settlement.service";

import { WagerTransactionKind } from "../../src/domain/wager/wager-transaction.types";

const CONSUMER = "wager-transactions-consumer";

class FailingOnEventUnitOfWork extends UnitOfWork
{
    constructor(private readonly inner: UnitOfWork, private readonly failingEventType: string)
    {
        super();
    }

    public run<T>(work: (scope: TransactionScope) => Promise<T>): Promise<T>
    {
        return this.inner.run((scope) => work({
            ...scope,
            outbox: {
                enqueue: (message) =>
                {
                    if (message.eventType === this.failingEventType) throw new Error("falha simulada antes do commit");
                    scope.outbox.enqueue(message);
                },
                claimDue: (now, limit) => scope.outbox.claimDue(now, limit),
                save: (message) => scope.outbox.save(message),
                oldestPendingSince: () => scope.outbox.oldestPendingSince(),
            },
        }));
    }
}

describe("Integração: atomicidade, inbox e outbox", () =>
{
    let ctx: TestContext;
    let publisher: RecordingPublisher;

    beforeAll(async () =>
    {
        publisher = new RecordingPublisher();
        ctx = await createTestContext(publisher);
    });

    afterAll(async () =>
    {
        await ctx.close();
    });

    const sql = (query: string, params: unknown[] = []) => ctx.orm.em.fork().execute(query, params);

    function bet(walletId: string, playerId: string, externalTransactionId: string, amount = "10.00")
    {
        return {
            providerId: "provider-msg",
            externalTransactionId,
            idempotencyKey: `key-${externalTransactionId}`,
            playerId,
            walletId,
            roundId: "round-msg",
            gameId: "game-msg",
            kind: WagerTransactionKind.Bet,
            money: { amount, currency: "BRL" },
        };
    }

    it("Falha no meio da transação não deixa nenhum efeito persistido, e a nova tentativa processa normalmente", async () =>
    {
        const playerId = uuidv7();
        const wallet = await ctx.openWallet.execute({ playerId, initialBalance: { amount: "100.00", currency: "BRL" } });
        const external = `ext-atomic-${uuidv7()}`;

        const faulty = new ProcessWagerUseCase(
            new FailingOnEventUnitOfWork(ctx.uow, "WagerTransactionProcessed"),
            new WagerSettlementService(ctx.metrics),
            ctx.metrics,
            ctx.logger,
        );

        await expect(faulty.execute(bet(wallet.id, playerId, external))).rejects.toThrow("falha simulada");

        expect((await ctx.getWallet.execute(wallet.id)).balance.amount).toBe("100.00");
        expect(await ctx.getTransaction.byExternalId("provider-msg", external).catch(() => "absent")).toBe("absent");
        expect((await sql("select count(*)::int as c from wallet_ledger_entries where wallet_id = ?", [wallet.id]))[0]?.c).toBe(1);
        expect((await sql("select count(*)::int as c from outbox_messages where aggregate_id = ?", [wallet.id]))[0]?.c).toBe(0);

        const retry = await ctx.processWager.execute(bet(wallet.id, playerId, external));
        expect(retry.idempotentReplay).toBe(false);
        expect(retry.balance.amount).toBe("90.00");
    });

    it("Redelivery da mesma mensagem SQS (ack perdido) não duplica o débito e confirma o inbox", async () =>
    {
        const playerId = uuidv7();
        const wallet = await ctx.openWallet.execute({ playerId, initialBalance: { amount: "100.00", currency: "BRL" } });
        const messageId = `msg-${uuidv7()}`;
        const command = bet(wallet.id, playerId, `ext-redeliver-${uuidv7()}`, "25.00");
        const inbox = { consumerName: CONSUMER, messageId, payloadHash: "hash-redeliver" };

        const first = await ctx.processWager.execute(command, { channel: "sqs", inbox });
        const second = await ctx.processWager.execute(command, { channel: "sqs", inbox });

        expect(first.idempotentReplay).toBe(false);
        expect(second.idempotentReplay).toBe(true);
        expect(second.transactionId).toBe(first.transactionId);
        expect((await ctx.getWallet.execute(wallet.id)).balance.amount).toBe("75.00");

        const [row] = await sql("select processed_at from inbox_messages where consumer_name = ? and message_id = ?", [CONSUMER, messageId]);
        expect(row?.processed_at).not.toBeNull();
    });

    it("Mesmo messageId com payload diferente é erro permanente (inbox), sem efeito no saldo", async () =>
    {
        const playerId = uuidv7();
        const wallet = await ctx.openWallet.execute({ playerId, initialBalance: { amount: "100.00", currency: "BRL" } });
        const messageId = `msg-${uuidv7()}`;

        await ctx.processWager.execute(bet(wallet.id, playerId, `ext-inbox-a-${uuidv7()}`), {
            channel: "sqs",
            inbox: { consumerName: CONSUMER, messageId, payloadHash: "hash-original" },
        });

        await expect(ctx.processWager.execute(bet(wallet.id, playerId, `ext-inbox-b-${uuidv7()}`), {
            channel: "sqs",
            inbox: { consumerName: CONSUMER, messageId, payloadHash: "hash-diferente" },
        })).rejects.toThrow(InboxPayloadMismatchError);

        expect((await ctx.getWallet.execute(wallet.id)).balance.amount).toBe("90.00");
    });

    it("Crash após o commit e antes da publicação: outra instância publica o evento pendente", async () =>
    {
        const crashing = await createTestContext(new RecordingPublisher());
        const playerId = uuidv7();
        const wallet = await crashing.openWallet.execute({ playerId, initialBalance: { amount: "100.00", currency: "BRL" } });
        const processed = await crashing.processWager.execute(bet(wallet.id, playerId, `ext-crash-${uuidv7()}`));

        await crashing.close();

        const survivor = new RecordingPublisher();
        const recovery = await createTestContext(survivor);

        let found = false;
        for (let i = 0; i < 100 && !found; i++)
        {
            await recovery.publishOutbox.execute();
            found = survivor.published.some((m) => m.eventType === "WagerTransactionProcessed" && (m.payload as { data: { transactionId: string } }).data.transactionId === processed.transactionId);
        }

        await recovery.close();
        expect(found).toBe(true);
    });

    it("Falha de publicação agenda nova tentativa com backoff e o evento é publicado depois", async () =>
    {
        const flaky = new RecordingPublisher();
        const flakyCtx = await createTestContext(flaky);

        const playerId = uuidv7();
        const wallet = await flakyCtx.openWallet.execute({ playerId, initialBalance: { amount: "100.00", currency: "BRL" } });
        const processed = await flakyCtx.processWager.execute(bet(wallet.id, playerId, `ext-retry-${uuidv7()}`));

        flaky.failWith = new Error("broker indisponível");
        for (let i = 0; i < 100; i++) await flakyCtx.publishOutbox.execute();

        const [pending] = await sql("select attempts, published_at, next_attempt_at from outbox_messages where aggregate_id = ? and event_type = 'WagerTransactionProcessed'", [processed.transactionId]);
        expect(pending?.attempts).toBeGreaterThanOrEqual(1);
        expect(pending?.published_at).toBeNull();
        expect(new Date(pending?.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
        expect(flaky.published.some((m) => m.aggregateId === processed.transactionId)).toBe(false);

        flaky.failWith = undefined;
        await sql("update outbox_messages set next_attempt_at = now() - interval '1 second' where aggregate_id = ?", [processed.transactionId]);
        for (let i = 0; i < 100 && !flaky.published.some((m) => m.aggregateId === processed.transactionId); i++)
            await flakyCtx.publishOutbox.execute();

        expect(flaky.published.some((m) => m.aggregateId === processed.transactionId)).toBe(true);
        await flakyCtx.close();
    });

    it("Evento publicado carrega envelope serializado com eventId estável (deduplicação no consumidor)", async () =>
    {
        const playerId = uuidv7();
        const wallet = await ctx.openWallet.execute({ playerId, initialBalance: { amount: "100.00", currency: "BRL" } });
        const processed = await ctx.processWager.execute(bet(wallet.id, playerId, `ext-env-${uuidv7()}`));

        for (let i = 0; i < 100 && !publisher.published.some((m) => m.aggregateId === processed.transactionId); i++)
            await ctx.publishOutbox.execute();

        const message = publisher.published.find((m) => m.aggregateId === processed.transactionId)!;
        const envelope = message.payload as { eventId: string; eventType: string; version: number; occurredAt: string; data: { money: { amount: string } } };

        expect(envelope.eventId).toBe(message.id);
        expect(envelope.version).toBe(1);
        expect(Date.parse(envelope.occurredAt)).not.toBeNaN();
        expect(typeof envelope.data.money.amount).toBe("string");
    });
});
