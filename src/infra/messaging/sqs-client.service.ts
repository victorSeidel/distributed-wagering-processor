import { Injectable, type OnModuleInit, Logger } from "@nestjs/common";
import { SQSClient, SendMessageCommand, type Message, GetQueueUrlCommand } from "@aws-sdk/client-sqs";

@Injectable()
export class SqsService implements OnModuleInit
{
    private readonly logger = new Logger(SqsService.name);
    private client!: SQSClient;
    private queueUrl!: string;
    private dlqUrl!: string;
    private eventsQueueUrl!: string;

    private readonly queueName = "wager-transactions.fifo";
    private readonly dlqName = "wager-transactions-dlq.fifo";
    private readonly eventsQueueName = "wager-events.fifo";

    async onModuleInit()
    {
        const endpoint = process.env.AWS_ENDPOINT!;
        const region = process.env.AWS_REGION!;

        this.client = new SQSClient({
            endpoint,
            region,
            credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID!, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY! },
        });

        await this.resolveQueueUrls();
    }

    public getClient(): SQSClient
    {
        return this.client;
    }

    public getQueueUrl(): string
    {
        return this.queueUrl;
    }

    public getEventsQueueUrl(): string
    {
        return this.eventsQueueUrl;
    }

    public getDlqUrl(): string
    {
        return this.dlqUrl;
    }

    private async resolveQueueUrls(retries = 15, delayMs = 2000): Promise<void>
    {
        for (let attempt = 1; attempt <= retries; attempt++)
        {
            try
            {
                const [queue, dlq, events] = await Promise.all([
                    this.client.send(new GetQueueUrlCommand({ QueueName: this.queueName })),
                    this.client.send(new GetQueueUrlCommand({ QueueName: this.dlqName })),
                    this.client.send(new GetQueueUrlCommand({ QueueName: this.eventsQueueName })),
                ]);

                this.queueUrl = queue.QueueUrl!;
                this.dlqUrl = dlq.QueueUrl!;
                this.eventsQueueUrl = events.QueueUrl!;
                return;
            }
            catch (err)
            {
                if (attempt === retries)
                {
                    this.logger.error(`Não foi possível obter as filas: ${err}`);
                    throw err;
                }

                this.logger.warn(`Filas indisponíveis (tentativa ${attempt}/${retries}), nova tentativa em ${delayMs}ms`);
                await new Promise((r) => setTimeout(r, delayMs));
            }
        }
    }

    public async publishToFifo(params: { queueUrl?: string; messageBody: string; messageGroupId: string; messageDeduplicationId: string; }): Promise<void>
    {
        const command = new SendMessageCommand({
            QueueUrl: params.queueUrl || this.eventsQueueUrl,
            MessageBody: params.messageBody,
            MessageGroupId: params.messageGroupId,
            MessageDeduplicationId: params.messageDeduplicationId,
        });

        await this.client.send(command);
    }

    public async sendToDlq(message: Message, consumerName: string, errorCode: string): Promise<void>
    {
        await this.getClient().send(new SendMessageCommand({
            QueueUrl: this.getDlqUrl(),
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
}