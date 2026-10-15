import { Injectable, type OnModuleInit, type OnModuleDestroy, Logger } from "@nestjs/common";

import { ReceiveMessageCommand, DeleteMessageCommand, ChangeMessageVisibilityCommand, type Message } from "@aws-sdk/client-sqs";

import { hashPayload } from "../../domain/common/canonical-json";
import { BusinessError, PermanentError, TransientError, InvalidMessageError } from "../../domain/common/errors";

import { SqsService } from "./sqs-client.service";
import type { InboxContext, ProcessWagerInput, ProcessWagerUseCase } from "../../application/usecase/process-wager.usecase";

export interface SqsWagerMessageEnvelope
{
    messageId: string;
    type: string;
    occurredAt: string;
    data: ProcessWagerInput;
}

@Injectable()
export class SqsConsumerService implements OnModuleInit, OnModuleDestroy
{
    private readonly logger = new Logger(SqsConsumerService.name);
    private readonly consumerName = "wager-transactions-consumer";

    private isRunning = false;
    private isPolling = false;

    private readonly maxReceiveCount = 5;
    private readonly backoffBaseSeconds = 5;
    private readonly backoffMaxSeconds = 300;

    constructor(
        private readonly sqsService: SqsService,
        private readonly processWagerUseCase: ProcessWagerUseCase,
    ) {}

    onModuleInit()
    {
        this.isRunning = true;
        this.startPollingLoop();
        this.logger.log("SQS Consumer iniciado com Inbox Pattern persistente.");
    }

    async onModuleDestroy()
    {
        this.logger.log("Recebido sinal de shutdown. Parando polling do SQS...");
        this.isRunning = false;

        while (this.isPolling) { await new Promise((resolve) => setTimeout(resolve, 100)); }
        this.logger.log("SQS Consumer finalizado com sucesso.");
    }

    private async startPollingLoop(): Promise<void>
    {
        while (this.isRunning)
        {
            try
            {
                this.isPolling = true;
                await this.pollMessages();
            }
            catch (err: unknown)
            {
                const errorMsg = err instanceof Error ? err.message : String(err);
                this.logger.error(`Erro inesperado no loop SQS: ${errorMsg}`);
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }
            finally
            {
                this.isPolling = false;
            }
        }
    }

    private async pollMessages(): Promise<void>
    {
        const client = this.sqsService.getClient();
        const queueUrl = this.sqsService.getQueueUrl();

        const command = new ReceiveMessageCommand({
            QueueUrl: queueUrl,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 5,
            VisibilityTimeout: 30,
            MessageSystemAttributeNames: ["ApproximateReceiveCount"],
        });

        const response = await client.send(command);
        if (!response.Messages || response.Messages.length === 0) return;

        for (const message of response.Messages) await this.handleMessage(message, queueUrl);
    }

    private async handleMessage(message: Message, queueUrl: string): Promise<void>
    {
        if (!message.ReceiptHandle) return;

        const receiptHandle = message.ReceiptHandle;
        const receiveCount = Number(message.Attributes?.ApproximateReceiveCount ?? 1);
        const sqsMessageId = message.MessageId ?? "unknown";
        let messageId = "unknown";

        try
        {
            const { envelope, inbox } = this.parseEnvelope(message);
            messageId = envelope.messageId;

            const result = await this.processWagerUseCase.execute(envelope.data, inbox);
            if (result.idempotentReplay) this.logger.warn(`Mensagem duplicada: messageId=${messageId} sqsMessageId=${sqsMessageId}. ACK.`);

            await this.ackMessage(queueUrl, receiptHandle);
        }
        catch (err: unknown)
        {
            await this.handleFailure(err, message, queueUrl, { messageId, sqsMessageId, receiveCount });
        }
    }

    private parseEnvelope(message: Message): { envelope: SqsWagerMessageEnvelope; inbox: InboxContext }
    {
        if (!message.Body) throw new InvalidMessageError("Corpo da mensagem vazio");

        let envelope: SqsWagerMessageEnvelope;
        try
        {
            envelope = JSON.parse(message.Body);
        }
        catch (e)
        {
            throw new InvalidMessageError(`JSON inválido (${e instanceof Error ? e.name : "unknown"}, ${message.Body.length} bytes)`);
        }

        if (typeof envelope?.messageId !== "string" || !envelope.messageId || typeof envelope.data !== "object" || envelope.data === null)
            throw new InvalidMessageError("Envelope sem messageId/data");

        return {
            envelope,
            inbox: {
                consumerName: this.consumerName,
                messageId: envelope.messageId,
                payloadHash: hashPayload(envelope.data as unknown as Record<string, unknown>),
            },
        };
    }

    private classify(err: unknown): { kind: "business" | "permanent" | "transient"; code: string }
    {
        if (err instanceof BusinessError) return { kind: "business", code: err.code };
        if (err instanceof PermanentError) return { kind: "permanent", code: err.code };
        return { kind: "transient", code: err instanceof TransientError ? err.code : "UNEXPECTED" };
    }

    private computeBackoffSeconds(receiveCount: number): number
    {
        const exp = Math.min(this.backoffBaseSeconds * 2 ** Math.max(receiveCount - 1, 0), this.backoffMaxSeconds);
        const half = exp / 2;
        return Math.floor(half + Math.random() * half);
    }

    private async handleFailure(
        err: unknown,
        message: Message,
        queueUrl: string,
        ctx: { messageId: string; sqsMessageId: string; receiveCount: number },
    ): Promise<void>
    {
        const { kind, code } = this.classify(err);
        const reason = err instanceof Error ? err.message : String(err);
        const tag = `messageId=${ctx.messageId} sqsMessageId=${ctx.sqsMessageId} receiveCount=${ctx.receiveCount} code=${code}`;
        const receiptHandle = message.ReceiptHandle!;

        try
        {
            if (kind === "business")
            {
                this.logger.warn(`Erro de negócio, descartando com ACK: ${tag} reason="${reason}"`);
                await this.ackMessage(queueUrl, receiptHandle);
                return;
            }

            if (kind === "permanent")
            {
                this.logger.error(`Erro permanente, enviando para DLQ: ${tag} reason="${reason}"`);
                await this.sqsService.sendToDlq(message, this.consumerName, code);
                await this.ackMessage(queueUrl, receiptHandle);
                return;
            }

            const delay = this.computeBackoffSeconds(ctx.receiveCount);
            const last = ctx.receiveCount >= this.maxReceiveCount ? " (última tentativa, redrive enviará para a DLQ)" : "";
            this.logger.error(`Erro transiente${last}: ${tag} retryIn=${delay}s reason="${reason}"`);
            await this.sqsService.getClient().send(new ChangeMessageVisibilityCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle, VisibilityTimeout: delay }));
        }
        catch (handlingErr)
        {
            this.logger.error(`Falha ao tratar erro (${kind}): ${tag} cause=${handlingErr instanceof Error ? handlingErr.message : String(handlingErr)}`);
        }
    }

    private async ackMessage(queueUrl: string, receiptHandle: string): Promise<void>
    {
        await this.sqsService.getClient().send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }));
    }
}