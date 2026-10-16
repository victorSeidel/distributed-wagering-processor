import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ChangeMessageVisibilityCommand, DeleteMessageCommand, ReceiveMessageCommand, type Message } from "@aws-sdk/client-sqs";

import { hashPayload } from "../../../domain/shared/canonical-json";
import { BusinessError, PermanentError } from "../../../domain/shared/errors";

import type { InboxContext, ProcessWagerCommand } from "../../../application/dto/wager.dto";
import { InvalidMessageError } from "../../../application/errors";
import { AppLogger, Metrics } from "../../../application/ports/observability.port";
import { ProcessWagerUseCase } from "../../../application/usecases/process-wager.usecase";

import { SqsClientService } from "./sqs-client.service";

import { RequestContext } from "../../observability/request-context";

interface WagerMessageEnvelope
{
    messageId: string;
    type: string;
    occurredAt: string;
    data: ProcessWagerCommand;
}

type FailureKind = "business" | "permanent" | "transient";

const CONSUMER_NAME = "wager-transactions-consumer";
const EXPECTED_TYPE = "WagerTransactionRequested";

const MAX_RECEIVE_COUNT = 5;
const VISIBILITY_TIMEOUT_SECONDS = 30;
const BACKOFF_BASE_SECONDS = 5;
const BACKOFF_MAX_SECONDS = 300;

@Injectable()
export class SqsCommandConsumer implements OnModuleInit, OnModuleDestroy
{
    private isRunning = false;
    private loop?: Promise<void>;

    constructor(
        private readonly sqs: SqsClientService,
        private readonly processWager: ProcessWagerUseCase,
        private readonly logger: AppLogger,
        private readonly metrics: Metrics,
    ) {}

    onModuleInit()
    {
        this.isRunning = true;
        this.loop = this.pollForever();
        this.logger.info("Consumidor SQS iniciado");
    }

    async onModuleDestroy()
    {
        this.logger.info("Shutdown recebido: parando o polling do SQS");
        this.isRunning = false;
        await this.loop;
        this.logger.info("Consumidor SQS finalizado");
    }

    private async pollForever(): Promise<void>
    {
        while (this.isRunning)
        {
            try
            {
                await this.pollOnce();
            }
            catch (err)
            {
                this.logger.error("Erro inesperado no loop do SQS", {}, err);
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }
        }
    }

    private async pollOnce(): Promise<void>
    {
        const response = await this.sqs.getClient().send(new ReceiveMessageCommand({
            QueueUrl: this.sqs.commandsQueueUrl,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 5,
            VisibilityTimeout: VISIBILITY_TIMEOUT_SECONDS,
            MessageSystemAttributeNames: ["ApproximateReceiveCount", "MessageGroupId"],
        }));

        for (const message of response.Messages ?? [])
        {
            if (!this.isRunning)
            {
                await this.releaseVisibility(message);
                continue;
            }

            await this.handle(message);
        }
    }

    private async handle(message: Message): Promise<void>
    {
        if (!message.ReceiptHandle) return;

        const receiveCount = Number(message.Attributes?.ApproximateReceiveCount ?? 1);
        let messageId = message.MessageId ?? "unknown";

        await RequestContext.run({ correlationId: messageId, messageId }, async () =>
        {
            try
            {
                const { envelope, inbox } = this.parse(message);
                messageId = envelope.messageId;

                await RequestContext.run({ correlationId: envelope.data.correlationId ?? envelope.messageId, messageId }, async () =>
                {
                    await this.processWager.execute(
                        { ...envelope.data, correlationId: envelope.data.correlationId ?? envelope.messageId },
                        { channel: "sqs", inbox },
                    );

                    await this.ack(message);
                });
            }
            catch (err)
            {
                await this.handleFailure(err, message, { messageId, receiveCount });
            }
        });
    }

    private parse(message: Message): { envelope: WagerMessageEnvelope; inbox: InboxContext }
    {
        if (!message.Body) throw new InvalidMessageError("Corpo da mensagem vazio");

        let envelope: WagerMessageEnvelope;
        try
        {
            envelope = JSON.parse(message.Body);
        }
        catch
        {
            throw new InvalidMessageError(`JSON inválido (${message.Body.length} bytes)`);
        }

        if (envelope?.type !== EXPECTED_TYPE) throw new InvalidMessageError(`Tipo de mensagem não suportado nesta fila: ${String(envelope?.type)}`);

        if (typeof envelope.messageId !== "string" || !envelope.messageId || typeof envelope.data !== "object" || envelope.data === null)
            throw new InvalidMessageError("Envelope sem messageId/data");

        return {
            envelope,
            inbox: {
                consumerName: CONSUMER_NAME,
                messageId: envelope.messageId,
                payloadHash: hashPayload(envelope.data as unknown as Record<string, unknown>),
            },
        };
    }

    private classify(err: unknown): FailureKind
    {
        if (err instanceof BusinessError) return "business";
        if (err instanceof PermanentError) return "permanent";
        return "transient";
    }

    private async handleFailure(err: unknown, message: Message, context: { messageId: string; receiveCount: number }): Promise<void>
    {
        const kind = this.classify(err);
        const code = (err as { code?: string }).code ?? "UNEXPECTED";
        const fields = { messageId: context.messageId, sqsMessageId: message.MessageId, receiveCount: context.receiveCount, code, kind };

        try
        {
            if (kind === "business")
            {
                this.logger.warn("Erro de negócio: mensagem descartada com ack", { ...fields, reason: (err as Error).message });
                await this.ack(message);
                return;
            }

            if (kind === "permanent")
            {
                this.logger.error("Erro permanente: mensagem enviada para a DLQ", { ...fields, reason: (err as Error).message });
                await this.sqs.sendToDeadLetter(message, CONSUMER_NAME, code);
                this.metrics.deadLettered(code);
                await this.ack(message);
                return;
            }

            const delay = this.backoffSeconds(context.receiveCount);
            const lastAttempt = context.receiveCount >= MAX_RECEIVE_COUNT;

            this.logger.error(lastAttempt
                ? "Erro transitório na última tentativa: o redrive enviará a mensagem para a DLQ"
                : "Erro transitório: nova tentativa agendada", 
                { ...fields, retryInSeconds: delay }, err
            );

            if (lastAttempt) this.metrics.deadLettered("max_receive_count");
            else this.metrics.retry("sqs_consumer");

            await this.changeVisibility(message, delay);
        }
        catch (handlingErr)
        {
            this.logger.error("Falha ao tratar o erro da mensagem", fields, handlingErr);
        }
    }

    private backoffSeconds(receiveCount: number): number
    {
        const exponential = Math.min(BACKOFF_BASE_SECONDS * 2 ** Math.max(receiveCount - 1, 0), BACKOFF_MAX_SECONDS);
        return Math.floor(exponential / 2 + Math.random() * (exponential / 2));
    }

    private async ack(message: Message): Promise<void>
    {
        await this.sqs.getClient().send(
            new DeleteMessageCommand({ QueueUrl: this.sqs.commandsQueueUrl, ReceiptHandle: message.ReceiptHandle })
        );
    }

    private async changeVisibility(message: Message, seconds: number): Promise<void>
    {
        await this.sqs.getClient().send(
            new ChangeMessageVisibilityCommand({ QueueUrl: this.sqs.commandsQueueUrl, ReceiptHandle: message.ReceiptHandle, VisibilityTimeout: seconds })
        );
    }

    private async releaseVisibility(message: Message): Promise<void>
    {
        try
        {
            await this.changeVisibility(message, 0);
        }
        catch (err)
        {
            this.logger.warn("Não foi possível devolver a visibilidade da mensagem no shutdown",
                { sqsMessageId: message.MessageId, reason: err instanceof Error ? err.message : String(err) });
        }
    }
}