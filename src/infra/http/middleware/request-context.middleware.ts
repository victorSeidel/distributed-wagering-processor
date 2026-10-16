import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

import { AppLogger } from "../../../application/ports/observability.port";
import { PrometheusMetrics } from "../../observability/prometheus-metrics";
import { RequestContext } from "../../observability/request-context";

const CORRELATION_HEADER = "x-correlation-id";
const VALID_CORRELATION_ID = /^[\w.:-]{1,100}$/;

/**
 * Estabelece o contexto da requisição (correlationId vindo do header ou gerado),
 * devolve-o na resposta e registra uma linha de log + métrica de latência por requisição.
 * Nunca registra corpo nem query string.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware
{
    constructor(
        private readonly logger: AppLogger,
        private readonly metrics: PrometheusMetrics,
    ) {}

    use(req: Request, res: Response, next: NextFunction): void
    {
        const header = req.header(CORRELATION_HEADER);
        const correlationId = header && VALID_CORRELATION_ID.test(header) ? header : crypto.randomUUID();
        const startedAt = performance.now();

        res.setHeader(CORRELATION_HEADER, correlationId);
        req.headers[CORRELATION_HEADER] = correlationId;

        res.on("finish", () =>
        {
            const seconds = (performance.now() - startedAt) / 1000;
            const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : "unmatched";

            this.metrics.httpRequest(req.method, route, res.statusCode, seconds);

            if (route !== "/health/live" && route !== "/metrics")
                RequestContext.run({ correlationId }, () => this.logger.info("Requisição HTTP concluída",
                    { method: req.method, route, status: res.statusCode, durationMs: Math.round(seconds * 1000) }));
        });

        RequestContext.run({ correlationId }, next);
    }
}