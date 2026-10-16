import { Controller, Get, Header } from "@nestjs/common";

import { PrometheusMetrics } from "../../observability/prometheus-metrics";

@Controller("metrics")
export class MetricsController
{
    constructor(private readonly metrics: PrometheusMetrics) {}

    @Get()
    @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
    render(): Promise<string>
    {
        return this.metrics.render();
    }
}