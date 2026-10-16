import { Injectable, type OnModuleInit } from "@nestjs/common";
import { GetQueueUrlCommand, SQSClient, SendMessageCommand, type Message } from "@aws-sdk/client-sqs";

import { AppLogger } from "../../../application/ports/observability.port";
import { requireEnv } from "../../config/env";

export const QueueNames =
{
    commands: "wager-transactions.fifo",
    deadLetter: "wager-transactions-dlq.fifo",
    events: "wager-events.fifo", // Destino dos eventos de integração da outbox. Separado da fila de comandos que o app consome.
} as const;

@Injectable()
export class SqsClientService implements OnModuleInit
{
    private client!: SQSClient;
    private commandsUrl!: string;
    private deadLetterUrl!: string;
    private eventsUrl!: string;

    constructor(private readonly logger: AppLogger) {}

    async onModuleInit()
    {
        this.client = new SQSClient({
            endpoint: requireEnv("AWS_ENDPOINT"),
            region: requireEnv("AWS_REGION"),
            credentials: { accessKeyId: requireEnv("AWS_ACCESS_KEY_ID"), secretAccessKey: requireEnv("AWS_SECRET_ACCESS_KEY") },
        });

        await this.resolveQueueUrls();
    }

    public getClient(): SQSClient
    {
        return this.client;
    }

    public get commandsQueueUrl(): string
    {
        return this.commandsUrl;
    }

    public get eventsQueueUrl(): string
    {
        return this.eventsUrl;
    }

    public get deadLetterQueueUrl(): string
    {
        return this.deadLetterUrl;
    }

    public async publishEvent(params: { messageBody: string; messageGroupId: string; messageDeduplicationId: string }): Promise<void>
    {
        await this.client.send(new SendMessageCommand({
            QueueUrl: this.eventsUrl,
            MessageBody: params.messageBody,
            MessageGroupId: params.messageGroupId,
            MessageDeduplicationId: params.messageDeduplicationId,
        }));
    }

    public async sendToDeadLetter(message: Message, consumerName: string, errorCode: string): Promise<void>
    {
        await this.client.send(new SendMessageCommand({
            QueueUrl: this.deadLetterUrl,
            MessageBody: message.Body || "<empty>",
            MessageGroupId: message.Attributes?.MessageGroupId ?? "dlq",
            MessageDeduplicationId: message.MessageId ?? crypto.randomUUID(),
            MessageAttributes: {
                ErrorCode: { DataType: "String", StringValue: errorCode },
                OriginalSqsMessageId: { DataType: "String", StringValue: message.MessageId ?? "unknown" },
                ReceiveCount: { DataType: "Number", StringValue: message.Attributes?.ApproximateReceiveCount ?? "1" },
                Consumer: { DataType: "String", StringValue: consumerName },
            },
        }));
    }

    private async resolveQueueUrls(retries = 15, delayMs = 2000): Promise<void>
    {
        for (let attempt = 1; attempt <= retries; attempt++)
        {
            try
            {
                const [commands, deadLetter, events] = await Promise.all([
                    this.client.send(new GetQueueUrlCommand({ QueueName: QueueNames.commands })),
                    this.client.send(new GetQueueUrlCommand({ QueueName: QueueNames.deadLetter })),
                    this.client.send(new GetQueueUrlCommand({ QueueName: QueueNames.events })),
                ]);

                this.commandsUrl = commands.QueueUrl!;
                this.deadLetterUrl = deadLetter.QueueUrl!;
                this.eventsUrl = events.QueueUrl!;
                return;
            }
            catch (err)
            {
                if (attempt === retries)
                {
                    this.logger.error("Não foi possível resolver as filas SQS", {}, err);
                    throw err;
                }

                this.logger.warn("Filas SQS indisponíveis; nova tentativa agendada", { attempt, retries, delayMs });
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
    }
}