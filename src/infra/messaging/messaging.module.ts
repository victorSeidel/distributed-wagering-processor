import { Global, Module } from "@nestjs/common";

import { ApplicationModule } from "../../application/application.module";
import { IntegrationEventPublisher } from "../../application/ports/messaging.port";

import { SqsClientService } from "./sqs/sqs-client.service";
import { SqsCommandConsumer } from "./sqs/sqs-command-consumer";
import { SqsEventPublisher } from "./sqs/sqs-event-publisher";

@Global()
@Module({
    imports: [
        ApplicationModule,
    ],
    
    providers: [
        SqsClientService,
        SqsEventPublisher,
        SqsCommandConsumer,
        { provide: IntegrationEventPublisher, useExisting: SqsEventPublisher },
    ],

    exports: [
        SqsClientService,
        IntegrationEventPublisher,
    ],
})

export class MessagingModule {}