import { Module } from "@nestjs/common";

import { ApplicationModule } from "./application/application.module";
import { WebModule } from "./infra/http/web.module";
import { MessagingModule } from "./infra/messaging/messaging.module";
import { ObservabilityModule } from "./infra/observability/observability.module";
import { PersistenceModule } from "./infra/persistence/persistence.module";
import { WorkersModule } from "./infra/workers/workers.module";

@Module({
    imports: [
        ObservabilityModule,
        PersistenceModule,
        ApplicationModule,
        MessagingModule,
        WorkersModule,
        WebModule,
    ],
})

export class AppModule {}