import { Injectable, type LoggerService } from "@nestjs/common";

import { DomainError } from "../../domain/shared/errors";
import { AppLogger, type LogFields } from "../../application/ports/observability.port";
import { sanitizeFields, serializeError } from "./log-redaction";
import { RequestContext } from "./request-context";

type Level = "info" | "warn" | "error" | "debug";

/**
 * Logger estruturado (uma linha JSON por evento) usado pela aplicação e pelo Nest.
 * Anexa correlationId/messageId do contexto corrente e redige dados sensíveis.
 */
@Injectable()
export class JsonLogger extends AppLogger implements LoggerService
{
    private readonly service = process.env.SERVICE_NAME ?? "wagering-processor";

    // AppLogger

    public info(message: string, fields?: LogFields): void
    {
        this.write("info", message, fields);
    }

    public warn(message: string, fields?: LogFields): void
    {
        this.write("warn", message, fields);
    }

    public error(message: string, fields?: LogFields, error?: unknown): void
    {
        this.write("error", message, fields, error);
    }

    // loggerService

    public log(message: unknown, context?: string): void
    {
        this.write("info", this.text(message), { context });
    }

    public fatal(message: unknown, context?: string): void
    {
        this.write("error", this.text(message), { context });
    }

    public debug(message: unknown, context?: string): void
    {
        if (process.env.LOG_LEVEL === "debug") this.write("debug", this.text(message), { context });
    }

    public verbose(message: unknown, context?: string): void
    {
        this.debug(message, context);
    }

    private text(message: unknown): string
    {
        return typeof message === "string" ? message : message instanceof Error ? message.message : JSON.stringify(sanitizeFields({ message }));
    }

    private write(level: Level, message: string, fields?: LogFields, error?: unknown): void
    {
        const current = RequestContext.current();

        const entry: Record<string, unknown> = {
            timestamp: new Date().toISOString(),
            level,
            service: this.service,
            message: message.length > 500 ? `${message.slice(0, 500)}…` : message,
            correlationId: current?.correlationId,
            messageId: current?.messageId,
            ...sanitizeFields(fields),
        };

        if (error !== undefined) entry.error = serializeError(error, !(error instanceof DomainError));

        const line = JSON.stringify(entry);
        if (level === "error") console.error(line);
        else if (level === "warn") console.warn(line);
        else console.log(line);
    }
}