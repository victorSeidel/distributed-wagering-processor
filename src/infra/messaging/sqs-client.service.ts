import { Injectable, type OnModuleInit, Logger } from "@nestjs/common";
import { SQSClient, SendMessageCommand, CreateQueueCommand, GetQueueAttributesCommand, type Message } from "@aws-sdk/client-sqs";

@Injectable()
export class SqsService implements OnModuleInit
{
    private readonly logger = new Logger(SqsService.name);
    private client!: SQSClient;
    private queueUrl!: string;
    private dlqUrl!: string;

    async onModuleInit()
    {
        const endpoint = process.env.AWS_ENDPOINT || "http://localhost:4566";
        const region = process.env.AWS_REGION || "us-east-1";

        this.client = new SQSClient({
            endpoint,
            region,
            credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test", secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test" },
        });

        await this.ensureQueuesExist();
    }

    public getClient(): SQSClient
    {
        return this.client;
    }

    public getQueueUrl(): string
    {
        return this.queueUrl;
    }

    public getDlqUrl(): string
    {
        return this.dlqUrl;
    }

    private async ensureQueuesExist(): Promise<void>
    {
        const queueName = "wager-transactions.fifo";
        const dlqName = "wager-transactions-dlq.fifo";

        try
        {
            const dlqRes = await this.client.send( new CreateQueueCommand({ QueueName: dlqName, Attributes: { FifoQueue: "true", ContentBasedDeduplication: "false" } }));
            this.dlqUrl = dlqRes.QueueUrl!;

            const dlqAttrs = await this.client.send(new GetQueueAttributesCommand({ QueueUrl: this.dlqUrl, AttributeNames: ["QueueArn"] }));
            const dlqArn = dlqAttrs.Attributes?.QueueArn;

            const redrivePolicy = JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: "5" });
            const queueRes = await this.client.send(
                new CreateQueueCommand({
                    QueueName: queueName,
                    Attributes: { FifoQueue: "true", ContentBasedDeduplication: "false", RedrivePolicy: redrivePolicy },
                })
            );
            this.queueUrl = queueRes.QueueUrl!;
        }
        catch (err)
        {
            this.logger.error(`Erro ao inicializar filas no LocalStack: ${err}`);
            throw err;
        }
    }

    public async publishToFifo(params: { queueUrl?: string; messageBody: string; messageGroupId: string; messageDeduplicationId: string; }): Promise<void>
    {
        const command = new SendMessageCommand({
            QueueUrl: params.queueUrl || this.queueUrl,
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
            MessageAttributes: {
                ErrorCode: { DataType: "String", StringValue: errorCode },
                OriginalSqsMessageId: { DataType: "String", StringValue: message.MessageId ?? "unknown" },
                ReceiveCount: { DataType: "Number", StringValue: message.Attributes?.ApproximateReceiveCount ?? "1" },
                Consumer: { DataType: "String", StringValue: consumerName },
            },
        }));
    }
}