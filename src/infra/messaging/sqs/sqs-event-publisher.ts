import { Injectable } from "@nestjs/common";

import type { OutboxMessage } from "../../../domain/messaging/outbox-message";

import { IntegrationEventPublisher } from "../../../application/ports/messaging.port";

import { SqsClientService } from "./sqs-client.service";

/**
 * Publica na fila de eventos FIFO.
 * MessageGroupId = aggregateId (ordem por agregado);
 * MessageDeduplicationId = id da outbox (= eventId), de modo que republicações são descartadas pelo broker.
 */
@Injectable()
export class SqsEventPublisher extends IntegrationEventPublisher
{
    constructor(private readonly sqs: SqsClientService)
    {
        super();
    }

    public async publish(message: OutboxMessage): Promise<void>
    {
        await this.sqs.publishEvent({
            messageBody: JSON.stringify(message.payload),
            messageGroupId: message.aggregateId,
            messageDeduplicationId: message.id,
        });
    }
}