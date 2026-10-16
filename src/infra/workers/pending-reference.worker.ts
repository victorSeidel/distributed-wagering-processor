import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import { AppLogger } from "../../application/ports/observability.port";
import { ProcessPendingReferencesUseCase } from "../../application/usecases/process-pending-references.usecase";
import { RequestContext } from "../observability/request-context";

@Injectable()
export class PendingReferenceWorker implements OnModuleInit, OnModuleDestroy
{
    private readonly intervalMs = 3000;
    private readonly maxPerTick = 20;
    private timer?: NodeJS.Timeout;
    private isRunning = false;
    private inFlight?: Promise<void>;

    constructor(
        private readonly processPending: ProcessPendingReferencesUseCase,
        private readonly logger: AppLogger,
    ) {}

    onModuleInit()
    {
        this.isRunning = true;
        this.timer = setInterval(() => this.tick(), this.intervalMs);
        this.logger.info("Worker de referências pendentes iniciado");
    }

    async onModuleDestroy()
    {
        this.isRunning = false;
        if (this.timer) clearInterval(this.timer);
        await this.inFlight;
        this.logger.info("Worker de referências pendentes finalizado");
    }

    private tick(): void
    {
        if (!this.isRunning || this.inFlight) return;

        this.inFlight = this.drain()
            .catch((err) => this.logger.error("Erro ao processar referências pendentes", {}, err))
            .finally(() => { this.inFlight = undefined; });
    }

    private async drain(): Promise<void>
    {
        for (let i = 0; i < this.maxPerTick && this.isRunning; i++)
        {
            const handled = await RequestContext.run({ correlationId: crypto.randomUUID() }, () => this.processPending.execute());
            if (!handled) break;
        }
    }
}