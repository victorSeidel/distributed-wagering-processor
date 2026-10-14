import { Injectable, type OnModuleInit, type OnModuleDestroy, Logger } from "@nestjs/common";
import { ReceiveMessageCommand, DeleteMessageCommand, ChangeMessageVisibilityCommand, type Message, } from "@aws-sdk/client-sqs";
import { EntityManager } from "@mikro-orm/postgresql";
import { SqsService } from "./sqs-client.service";
import type { ProcessWagerInput, ProcessWagerUseCase } from "../../applications/usecase/process-wager.usecase";
import { hashPayload } from "../../domain/common/canonical-json";
import { InboxMessageEntity } from "../database/entities/messaging.entity";
import { WagerTransactionStatus } from "../../model/entity/wager.entity";

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

    constructor(
        private readonly sqsService: SqsService,
        private readonly em: EntityManager,
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
        });

        const response = await client.send(command);
        if (!response.Messages || response.Messages.length === 0) return;

        for (const message of response.Messages) await this.handleMessage(message, queueUrl);
    }

    private async handleMessage(message: Message, queueUrl: string): Promise<void>
    {
        if (!message.ReceiptHandle || !message.Body) return;

        let envelope: SqsWagerMessageEnvelope;
        try
        {
            envelope = JSON.parse(message.Body);
        }
        catch
        {
            this.logger.error(`Payload inválido recebido no SQS: ${message.Body}. Deletando da fila.`);
            await this.ackMessage(queueUrl, message.ReceiptHandle);
            return;
        }

        const { messageId, data } = envelope;
        const payloadHash = hashPayload(data as unknown as Record<string, unknown>);
        const forkEm = this.em.fork();

        try
        {
            const alreadyProcessed = await forkEm.transactional(async (em) =>
            {
                const existingInbox = await em.findOne(InboxMessageEntity, { consumerName: this.consumerName, messageId });
                if (existingInbox && existingInbox.processedAt) return true;

                if (!existingInbox)
                {
                    const inboxEntry = new InboxMessageEntity();
                    inboxEntry.consumerName = this.consumerName;
                    inboxEntry.messageId = messageId;
                    inboxEntry.payloadHash = payloadHash;
                    inboxEntry.receivedAt = new Date();
                    em.persist(inboxEntry);
                }

                return false;
            });

            if (alreadyProcessed)
            {
                this.logger.warn(`Mensagem duplicada detectada pelo Inbox: ${messageId}. Enviando ACK.`);
                await this.ackMessage(queueUrl, message.ReceiptHandle);
                return;
            }

            await this.processWagerUseCase.execute(data);

            await forkEm.transactional(async (em) =>
            {
                const inbox = await em.findOne(InboxMessageEntity, { consumerName: this.consumerName, messageId });
                if (inbox) inbox.processedAt = new Date();
            });

            await this.ackMessage(queueUrl, message.ReceiptHandle);
        }
        catch (err: unknown)
        {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.logger.error(`Erro ao processar mensagem ${messageId}: ${errorMsg}`);
            try
            {
                await this.sqsService.getClient().send(
                    new ChangeMessageVisibilityCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle, VisibilityTimeout: 5 })
                );
            }
            catch (visErr)
            {
                this.logger.error(`Falha ao alterar visibilidade da mensagem: ${visErr}`);
            }
        }
    }

    private async ackMessage(queueUrl: string, receiptHandle: string): Promise<void>
    {
        await this.sqsService.getClient().send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }));
    }
}