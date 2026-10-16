import { Global, Module } from "@nestjs/common";

import { AppLogger, Metrics } from "../../application/ports/observability.port";
import { JsonLogger } from "./json-logger";
import { PrometheusMetrics } from "./prometheus-metrics";

@Global()
@Module({
    providers: [
        JsonLogger,
        PrometheusMetrics,
        { provide: AppLogger, useExisting: JsonLogger },
        { provide: Metrics, useExisting: PrometheusMetrics },
    ],
    exports: [JsonLogger, PrometheusMetrics, AppLogger, Metrics],
})

export class ObservabilityModule {}