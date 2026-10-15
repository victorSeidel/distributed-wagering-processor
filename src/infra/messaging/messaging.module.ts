import { Module } from "@nestjs/common";

import { SqsService } from "./sqs-client.service";
import { SqsConsumerService } from "./sqs-consumer.service";

import { OutboxRelayWorker } from "../worker/outbox-relay.worker";
import { WagerSettlementService } from "../../application/service/wager-settlement.service";
import { ProcessWagerUseCase } from "../../application/usecase/process-wager.usecase";

@Module({
    providers: [SqsService, OutboxRelayWorker, SqsConsumerService, ProcessWagerUseCase, WagerSettlementService],
    exports: [SqsService, OutboxRelayWorker],
})

export class MessagingModule {}