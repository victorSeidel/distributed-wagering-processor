import { Module } from "@nestjs/common";

import { ApplicationModule } from "../../application/application.module";
import { MessagingModule } from "../messaging/messaging.module";
import { OutboxRelayWorker } from "./outbox-relay.worker";
import { PendingReferenceWorker } from "./pending-reference.worker";

@Module({
    imports: [
        ApplicationModule,
        MessagingModule,
    ],

    providers: [
        OutboxRelayWorker,
        PendingReferenceWorker,
    ],
})

export class WorkersModule {}