import { Injectable, type OnModuleInit, type OnModuleDestroy, Logger } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { SqsService } from "./sqs-client.service";
import { OutboxMessageEntity } from "../database/entities/messaging.entity";

@Injectable()
export class OutboxRelayWorker implements OnModuleInit, OnModuleDestroy
{
    private readonly logger = new Logger(OutboxRelayWorker.name);
    private isRunning = false;
    private intervalRef: NodeJS.Timeout | null = null;
    private readonly batchSize = 25;
    private isProcessing = false;

    constructor(
        private readonly em: EntityManager,
        private readonly sqsService: SqsService,
    ) {}

    onModuleInit()
    {
        this.isRunning = true;
        this.intervalRef = setInterval(() => this.processOutboxBatch(), 500);
        this.logger.log("Outbox Relay Worker inicializado com SKIP LOCKED.");
    }

    onModuleDestroy()
    {
        this.isRunning = false;
        if (this.intervalRef) clearInterval(this.intervalRef);
        this.logger.log("Outbox Relay Worker encerrado com segurança.");
    }

    public async processOutboxBatch(): Promise<void>
    {
        if (!this.isRunning || this.isProcessing) return;

        this.isProcessing = true;
        const forkEm = this.em.fork();

        try
        {
            await forkEm.transactional(async (em) => 
            {
                const pendingRows = await em.getConnection().execute<{ id: string }[]>
                    (`SELECT id FROM outbox_messages WHERE published_at IS NULL AND next_attempt_at <= ? ORDER BY occurred_at ASC LIMIT ?FOR UPDATE SKIP LOCKED`,
                        [new Date(), this.batchSize],
                );

                if (pendingRows.length === 0) return;

                const ids = pendingRows.map((r: { id: string }) => r.id);
                const messages = await em.find(OutboxMessageEntity, { id: { $in: ids } });

                for (const outbox of messages)
                {
                    try
                    {
                        await this.sqsService.publishToFifo({
                            messageBody: JSON.stringify(outbox.payload),
                            messageGroupId: outbox.aggregateId,
                            messageDeduplicationId: outbox.id,
                        });

                        outbox.publishedAt = new Date();
                    }
                    catch (err: unknown)
                    {
                        const errorMsg = err instanceof Error ? err.message : String(err);
                        this.logger.error(`Falha ao publicar outbox ${outbox.id}: ${errorMsg}`);

                        outbox.attempts += 1;
                        const backoffMs = Math.min(Math.pow(2, outbox.attempts) * 1000, 60000);
                        outbox.nextAttemptAt = new Date(Date.now() + backoffMs);
                    }
                }

                await em.flush();
            });
        }
        catch (err: unknown)
        {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.logger.error(`Erro no loop do Outbox Relay: ${errorMsg}`);
        }
        finally
        {
            this.isProcessing = false;
        }
    }
}