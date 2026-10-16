import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import { AppLogger } from "../../application/ports/observability.port";
import { PublishOutboxUseCase } from "../../application/usecases/publish-outbox.usecase";
import { RequestContext } from "../observability/request-context";

@Injectable()
export class OutboxRelayWorker implements OnModuleInit, OnModuleDestroy
{
    private readonly intervalMs = 500;
    private timer?: NodeJS.Timeout;
    private isRunning = false;
    private inFlight?: Promise<void>;

    constructor(
        private readonly publishOutbox: PublishOutboxUseCase,
        private readonly logger: AppLogger,
    ) {}

    onModuleInit()
    {
        this.isRunning = true;
        this.timer = setInterval(() => this.tick(), this.intervalMs);
        this.logger.info("Outbox relay iniciado");
    }

    async onModuleDestroy()
    {
        this.isRunning = false;
        if (this.timer) clearInterval(this.timer);
        await this.inFlight;
        this.logger.info("Outbox relay finalizado");
    }

    private tick(): void
    {
        if (!this.isRunning || this.inFlight) return;

        this.inFlight = RequestContext.run({ correlationId: crypto.randomUUID() }, () => this.publishOutbox.execute())
            .then(() => undefined)
            .catch((err) => this.logger.error("Erro no ciclo do outbox relay", {}, err))
            .finally(() => { this.inFlight = undefined; });
    }
}