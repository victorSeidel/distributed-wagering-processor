import { type ArgumentsHost, Catch, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { ConnectionException, DeadlockException, LockWaitTimeoutException } from "@mikro-orm/core";
import type { Response } from "express";

import { DomainError } from "../../domain/common/errors";

@Catch()
export class GlobalExceptionFilter extends BaseExceptionFilter
{
    private readonly logger = new Logger(GlobalExceptionFilter.name);

    override catch(err: unknown, host: ArgumentsHost)
    {
        if (err instanceof HttpException) return super.catch(err, host);

        const response = host.switchToHttp().getResponse<Response>();

        if (err instanceof DomainError)
        {
            if (err.httpStatus >= 500) this.logger.error(`${err.code}: ${err.message}`);
            return response.status(err.httpStatus).json({ statusCode: err.httpStatus, code: err.code, message: err.message });
        }

        if (this.isTransientInfrastructureError(err))
        {
            this.logger.warn(`Falha transitória de infraestrutura: ${err instanceof Error ? err.message : String(err)}`);
            return response
                .status(HttpStatus.SERVICE_UNAVAILABLE)
                .set("Retry-After", "1")
                .json({ statusCode: 503, code: "TRANSIENT", message: "Serviço temporariamente indisponível, reenvie a requisição" });
        }

        this.logger.error(`Erro inesperado: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
        return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ statusCode: 500, code: "INTERNAL_ERROR", message: "Erro interno" });
    }

    private isTransientInfrastructureError(err: unknown): boolean
    {
        if (err instanceof ConnectionException || err instanceof DeadlockException || err instanceof LockWaitTimeoutException) return true;

        const code = (err as { code?: string } | null)?.code;
        return typeof code === "string" && ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "57P01", "57P03", "53300"].includes(code);
    }
}