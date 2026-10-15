import { Module } from "@nestjs/common";

import { SqsService } from "./sqs-client.service";
import { SqsConsumerService } from "./sqs-consumer.service";

import { OutboxRelayWorker } from "./outbox-relay.worker";
import { ProcessWagerUseCase } from "../../application/usecase/process-wager.usecase";

@Module({
    providers: [SqsService, OutboxRelayWorker, SqsConsumerService, ProcessWagerUseCase],
    exports: [SqsService, OutboxRelayWorker],
})

export class MessagingModule {}