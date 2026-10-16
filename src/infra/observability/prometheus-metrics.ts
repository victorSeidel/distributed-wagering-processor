import { Injectable } from "@nestjs/common";
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

import type { WagerFailureCode, WagerTransactionKind, WagerTransactionStatus } from "../../domain/wager/wager-transaction.types";
import { Metrics, type Channel, type LockResource, type RetryComponent } from "../../application/ports/observability.port";

/**
 * Métricas Prometheus (endpoint GET /metrics).
 * Os rótulos têm cardinalidade limitada: nunca recebem ids de wallet, jogador, transação ou valores monetários.
 */
@Injectable()
export class PrometheusMetrics extends Metrics
{
    public readonly registry = new Registry();

    private readonly transactions = new Counter({
        name: "wager_transactions_total",
        help: "Transações concluídas, por tipo, status e código de falha",
        labelNames: ["kind", "status", "failure_code"],
        registers: [this.registry],
    });

    private readonly duplicates = new Counter({
        name: "wager_duplicates_detected_total",
        help: "Duplicatas detectadas (replay idempotente), por canal de entrada",
        labelNames: ["channel"],
        registers: [this.registry],
    });

    private readonly conflicts = new Counter({
        name: "wager_idempotency_conflicts_total",
        help: "Mesma Idempotency-Key reutilizada com payload diferente",
        registers: [this.registry],
    });

    private readonly retries = new Counter({
        name: "wager_retries_total",
        help: "Retentativas por componente",
        labelNames: ["component"],
        registers: [this.registry],
    });

    private readonly dlq = new Counter({
        name: "wager_dlq_messages_total",
        help: "Mensagens enviadas (ou redirecionadas) para a DLQ, por motivo",
        labelNames: ["reason"],
        registers: [this.registry],
    });

    private readonly locks = new Counter({
        name: "wager_lock_conflicts_total",
        help: "Contenção de locks (espera acima do limiar ou deadlock), por recurso",
        labelNames: ["resource"],
        registers: [this.registry],
    });

    private readonly lag = new Gauge({
        name: "wager_outbox_lag_seconds",
        help: "Idade, em segundos, do evento pendente mais antigo da outbox",
        registers: [this.registry],
    });

    private readonly published = new Counter({
        name: "wager_outbox_published_total",
        help: "Eventos da outbox publicados com sucesso",
        registers: [this.registry],
    });

    private readonly duration = new Histogram({
        name: "wager_processing_duration_seconds",
        help: "Latência do processamento de transações, por canal e desfecho",
        labelNames: ["channel", "outcome"],
        buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
        registers: [this.registry],
    });

    private readonly divergences = new Counter({
        name: "wager_reconciliation_divergences_total",
        help: "Divergências entre saldo materializado e ledger detectadas na reconciliação",
        registers: [this.registry],
    });

    private readonly httpDuration = new Histogram({
        name: "http_request_duration_seconds",
        help: "Latência das requisições HTTP",
        labelNames: ["method", "route", "status"],
        buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
        registers: [this.registry],
    });

    constructor()
    {
        super();
        collectDefaultMetrics({ register: this.registry });
    }

    public transactionResolved(kind: WagerTransactionKind, status: WagerTransactionStatus, failureCode?: WagerFailureCode): void
    {
        this.transactions.inc({ kind, status, failure_code: failureCode ?? "none" });
    }

    public duplicateDetected(channel: Channel): void
    {
        this.duplicates.inc({ channel });
    }

    public idempotencyConflict(): void
    {
        this.conflicts.inc();
    }

    public retry(component: RetryComponent): void
    {
        this.retries.inc({ component });
    }

    public deadLettered(reason: string): void
    {
        this.dlq.inc({ reason });
    }

    public lockConflict(resource: LockResource): void
    {
        this.locks.inc({ resource });
    }

    public outboxLagSeconds(seconds: number): void
    {
        this.lag.set(seconds);
    }

    public outboxPublished(): void
    {
        this.published.inc();
    }

    public processingDuration(channel: Channel, outcome: string, seconds: number): void
    {
        this.duration.observe({ channel, outcome }, seconds);
    }

    public reconciliationDivergence(): void
    {
        this.divergences.inc();
    }

    public httpRequest(method: string, route: string, status: number, seconds: number): void
    {
        this.httpDuration.observe({ method, route, status: String(status) }, seconds);
    }

    public async render(): Promise<string>
    {
        return this.registry.metrics();
    }
}