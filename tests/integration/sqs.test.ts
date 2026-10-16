import { describe, expect, it, beforeAll, afterAll, setDefaultTimeout } from "bun:test";
setDefaultTimeout(30_000);

import { v7 as uuidv7 } from "uuid";

import { createTestContext, SilentLogger, type TestContext } from "../support/test-context";

import { GetQueueAttributesCommand, PurgeQueueCommand, ReceiveMessageCommand, SendMessageCommand, type Message } from "@aws-sdk/client-sqs";

import { TransientError } from "../../src/domain/shared/errors";
import { OutboxMessage } from "../../src/domain/messaging/outbox-message";
import { WagerTransactionStatus } from "../../src/domain/wager/wager-transaction.types";

import { SqsClientService, QueueNames } from "../../src/infra/messaging/sqs/sqs-client.service";
import { PrometheusMetrics } from "../../src/infra/observability/prometheus-metrics";
import { SqsCommandConsumer } from "../../src/infra/messaging/sqs/sqs-command-consumer";
import { SqsEventPublisher } from "../../src/infra/messaging/sqs/sqs-event-publisher";

import type { ProcessWagerUseCase } from "../../src/application/usecases/process-wager.usecase";

const LOCALSTACK = Boolean(process.env.AWS_ENDPOINT);

describe.skipIf(!LOCALSTACK)("SQS (LocalStack): comandos, DLQ e publicação de eventos", () =>
{
    let ctx: TestContext;
    let logger: SilentLogger;
    let sqs: SqsClientService;

    beforeAll(async () =>
    {
        ctx = await createTestContext();
        logger = new SilentLogger();
        sqs = new SqsClientService(logger);
        await sqs.onModuleInit();

        for (const url of [sqs.commandsQueueUrl, sqs.deadLetterQueueUrl, sqs.eventsQueueUrl])
            await sqs.getClient().send(new PurgeQueueCommand({ QueueUrl: url })).catch(() => undefined);
    });

    afterAll(async () =>
    {
        await ctx.close();
    });

    const sendCommand = (body: string | object, group: string, dedupId = uuidv7()) =>
        sqs.getClient().send(new SendMessageCommand({
            QueueUrl: sqs.commandsQueueUrl,
            MessageBody: typeof body === "string" ? body : JSON.stringify(body),
            MessageGroupId: group,
            MessageDeduplicationId: dedupId,
        }));

    const attributes = async (queueUrl: string) =>
    {
        const res = await sqs.getClient().send(new GetQueueAttributesCommand({
            QueueUrl: queueUrl,
            AttributeNames: ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
        }));
        
        return {
            visible: Number(res.Attributes?.ApproximateNumberOfMessages ?? 0),
            inFlight: Number(res.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0),
        };
    };

    async function waitUntilDrained(queueUrl: string, timeoutMs = 20_000): Promise<void>
    {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline)
        {
            const a = await attributes(queueUrl);
            if (a.visible === 0 && a.inFlight === 0) return;
            await new Promise((r) => setTimeout(r, 250));
        }
        throw new Error(`Fila ${queueUrl} não esvaziou dentro de ${timeoutMs}ms`);
    }

    async function receiveFrom(queueUrl: string): Promise<Message[]>
    {
        const res = await sqs.getClient().send(new ReceiveMessageCommand({
            QueueUrl: queueUrl,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 2,
            VisibilityTimeout: 0,
            MessageSystemAttributeNames: ["MessageGroupId"],
            MessageAttributeNames: ["All"],
        }));
        return res.Messages ?? [];
    }

    function command(walletId: string, playerId: string, messageId: string, amount = "10.00")
    {
        return {
            messageId,
            type: "WagerTransactionRequested",
            occurredAt: new Date().toISOString(),
            data: {
                providerId: "provider-sqs",
                externalTransactionId: `ext-${messageId}`,
                idempotencyKey: `provider-sqs:${messageId}`,
                playerId,
                walletId,
                roundId: "round-sqs",
                gameId: "game-sqs",
                kind: "BET",
                money: { amount, currency: "BRL" },
            },
        };
    }

    it("Comando válido é processado, confirmado e a fila esvazia", async () =>
    {
        const playerId = uuidv7();
        const wallet = await ctx.openWallet.execute({ playerId, initialBalance: { amount: "100.00", currency: "BRL" } });
        const messageId = `msg-${uuidv7()}`;

        const consumer = new SqsCommandConsumer(sqs, ctx.processWager, logger, new PrometheusMetrics());
        consumer.onModuleInit();
        await sendCommand(command(wallet.id, playerId, messageId), `wallet-${wallet.id}`);
        await waitUntilDrained(sqs.commandsQueueUrl);
        await consumer.onModuleDestroy();

        expect((await ctx.getTransaction.byExternalId("provider-sqs", `ext-${messageId}`)).status).toBe(WagerTransactionStatus.Processed);
        expect((await ctx.getWallet.execute(wallet.id)).balance.amount).toBe("90.00");
    });

    it("Redelivery da mesma mensagem não duplica o débito", async () =>
    {
        const playerId = uuidv7();
        const wallet = await ctx.openWallet.execute({ playerId, initialBalance: { amount: "100.00", currency: "BRL" } });
        const messageId = `msg-${uuidv7()}`;

        const consumer = new SqsCommandConsumer(sqs, ctx.processWager, logger, new PrometheusMetrics());
        consumer.onModuleInit();
        await sendCommand(command(wallet.id, playerId, messageId, "15.00"), `wallet-${wallet.id}`);
        await sendCommand(command(wallet.id, playerId, messageId, "15.00"), `wallet-${wallet.id}`);
        await waitUntilDrained(sqs.commandsQueueUrl);
        await consumer.onModuleDestroy();

        expect((await ctx.getWallet.execute(wallet.id)).balance.amount).toBe("85.00");
    });

    it("Mensagem com JSON inválido vai para a DLQ com ErrorCode e é removida da fila de comandos", async () =>
    {
        const consumer = new SqsCommandConsumer(sqs, ctx.processWager, logger, new PrometheusMetrics());
        consumer.onModuleInit();
        await sendCommand("{ isto não é json", "poison");
        await waitUntilDrained(sqs.commandsQueueUrl);
        await consumer.onModuleDestroy();

        const dlq = await receiveFrom(sqs.deadLetterQueueUrl);
        const found = dlq.find((m) => m.MessageAttributes?.ErrorCode?.StringValue === "INVALID_MESSAGE");
        expect(found).toBeDefined();
        expect(found!.MessageAttributes?.Consumer?.StringValue).toBe("wager-transactions-consumer");
    });

    it("Erro de negócio é descartado com ack, sem ir para a DLQ", async () =>
    {
        const dlqBefore = await attributes(sqs.deadLetterQueueUrl);
        const messageId = `msg-${uuidv7()}`;

        const consumer = new SqsCommandConsumer(sqs, ctx.processWager, logger, new PrometheusMetrics());
        consumer.onModuleInit();
        await sendCommand(command(uuidv7(), uuidv7(), messageId), "missing-wallet");
        await waitUntilDrained(sqs.commandsQueueUrl);
        await consumer.onModuleDestroy();

        const dlqAfter = await attributes(sqs.deadLetterQueueUrl);
        expect(dlqAfter.visible + dlqAfter.inFlight).toBe(dlqBefore.visible + dlqBefore.inFlight);
    });

    it("Erro transitório não confirma a mensagem: ela permanece na fila para nova tentativa", async () =>
    {
        const playerId = uuidv7();
        const wallet = await ctx.openWallet.execute({ playerId, initialBalance: { amount: "100.00", currency: "BRL" } });
        const failing = { execute: async () => { throw new TransientError("banco indisponível (simulado)"); } } as unknown as ProcessWagerUseCase;

        const consumer = new SqsCommandConsumer(sqs, failing, logger, new PrometheusMetrics());
        consumer.onModuleInit();
        await sendCommand(command(wallet.id, playerId, `msg-${uuidv7()}`), `wallet-${wallet.id}`);

        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline && (await attributes(sqs.commandsQueueUrl)).inFlight === 0) await new Promise((r) => setTimeout(r, 200));
        await consumer.onModuleDestroy();

        const after = await attributes(sqs.commandsQueueUrl);
        expect(after.visible + after.inFlight).toBe(1);
        expect((await ctx.getWallet.execute(wallet.id)).balance.amount).toBe("100.00");
    });

    it("Publicação de evento vai para a fila de eventos FIFO com MessageGroupId = aggregateId", async () =>
    {
        const aggregateId = uuidv7();
        const message = OutboxMessage.rehydrate({
            id: uuidv7(),
            aggregateId,
            eventType: "WagerTransactionProcessed",
            payload: { eventType: "WagerTransactionProcessed", aggregateId, data: { ok: true } },
            occurredAt: new Date(),
            attempts: 0,
        });

        await new SqsEventPublisher(sqs).publish(message);

        const received = (await receiveFrom(sqs.eventsQueueUrl)).find((m) => m.Attributes?.MessageGroupId === aggregateId);
        expect(received).toBeDefined();
        expect(JSON.parse(received!.Body!).eventType).toBe("WagerTransactionProcessed");
    });

    it("Nomes das filas seguem o provisionamento", () =>
    {
        expect(QueueNames.commands).toBe("wager-transactions.fifo");
        expect(QueueNames.deadLetter).toBe("wager-transactions-dlq.fifo");
        expect(QueueNames.events).toBe("wager-events.fifo");
    });
});
