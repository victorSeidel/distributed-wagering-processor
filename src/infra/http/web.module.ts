import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";

import { ApplicationModule } from "../../application/application.module";
import { MessagingModule } from "../messaging/messaging.module";
import { PersistenceModule } from "../persistence/persistence.module";
import { ReadinessService } from "../health/readiness.service";
import { HealthController } from "./controllers/health.controller";
import { MetricsController } from "./controllers/metrics.controller";
import { WageringController } from "./controllers/wagering.controller";
import { WalletsController } from "./controllers/wallet.controller";
import { GlobalExceptionFilter } from "./filters/global-exception.filter";
import { RequestContextMiddleware } from "./middleware/request-context.middleware";

@Module({
    imports: [ApplicationModule, MessagingModule, PersistenceModule],
    controllers: [WalletsController, WageringController, HealthController, MetricsController],
    providers: [
        ReadinessService,
        RequestContextMiddleware,
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    ],
})

export class WebModule implements NestModule
{
    configure(consumer: MiddlewareConsumer): void
    {
        consumer.apply(RequestContextMiddleware).forRoutes("*");
    }
}