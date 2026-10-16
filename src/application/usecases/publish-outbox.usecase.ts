import { Injectable } from "@nestjs/common";

import { AppLogger, Metrics } from "../ports/observability.port";
import { IntegrationEventPublisher } from "../ports/messaging.port";
import { UnitOfWork } from "../ports/unit-of-work.port";

const BATCH_SIZE = 25;

@Injectable()
export class PublishOutboxUseCase
{
    constructor(
        private readonly uow: UnitOfWork,
        private readonly publisher: IntegrationEventPublisher,
        private readonly metrics: Metrics,
        private readonly logger: AppLogger,
    ) {}

    public async execute(): Promise<number>
    {
        const published = await this.uow.run(async (scope) =>
        {
            const now = new Date();
            const due = await scope.outbox.claimDue(now, BATCH_SIZE);
            let count = 0;

            for (const message of due)
            {
                try
                {
                    await this.publisher.publish(message);
                    message.markPublished(new Date());
                    this.metrics.outboxPublished();
                    count += 1;
                }
                catch (err)
                {
                    message.scheduleRetry(new Date());
                    this.metrics.retry("outbox_publish");
                    this.logger.warn("Falha ao publicar evento da outbox; nova tentativa agendada", {
                        outboxId: message.id,
                        eventType: message.eventType,
                        attempts: message.attempts,
                        reason: err instanceof Error ? err.message : String(err),
                    });
                }

                scope.outbox.save(message);
            }

            const oldest = await scope.outbox.oldestPendingSince();
            this.metrics.outboxLagSeconds(oldest ? Math.max(0, (new Date().getTime() - oldest.getTime()) / 1000) : 0);

            return count;
        });

        return published;
    }
}