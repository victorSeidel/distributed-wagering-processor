import { type ArgumentsHost, Catch, HttpException, HttpStatus } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { ConnectionException, DeadlockException, LockWaitTimeoutException } from "@mikro-orm/core";
import type { Response } from "express";

import { BusinessError, DomainError, PermanentError, TransientError } from "../../../domain/shared/errors";
import { AppLogger } from "../../../application/ports/observability.port";

const STATUS_BY_CODE: Record<string, number> =
{
    INVALID_INPUT: HttpStatus.BAD_REQUEST,
    INVALID_MESSAGE: HttpStatus.BAD_REQUEST,
    WALLET_NOT_FOUND: HttpStatus.NOT_FOUND,
    TRANSACTION_NOT_FOUND: HttpStatus.NOT_FOUND,
    IDEMPOTENCY_CONFLICT: HttpStatus.CONFLICT,
    DUPLICATE_EXTERNAL_TRANSACTION: HttpStatus.CONFLICT,
    WALLET_ALREADY_EXISTS: HttpStatus.CONFLICT,
    CURRENCY_MISMATCH: HttpStatus.CONFLICT,
    CURRENCY_CONFLICT: HttpStatus.CONFLICT,
    UNIQUE_VIOLATION: HttpStatus.CONFLICT,
    INSUFFICIENT_FUNDS: HttpStatus.UNPROCESSABLE_ENTITY,
    INBOX_PAYLOAD_MISMATCH: HttpStatus.UNPROCESSABLE_ENTITY,
    INVALID_TRANSACTION_STATE: HttpStatus.INTERNAL_SERVER_ERROR,
    LEDGER_INVARIANT_VIOLATED: HttpStatus.INTERNAL_SERVER_ERROR,
};

@Catch()
export class GlobalExceptionFilter extends BaseExceptionFilter
{
    constructor(private readonly logger: AppLogger)
    {
        super();
    }

    override catch(err: unknown, host: ArgumentsHost)
    {
        if (err instanceof HttpException) return super.catch(err, host);

        const response = host.switchToHttp().getResponse<Response>();

        if (err instanceof TransientError || this.isTransientInfrastructureError(err))
        {
            this.logger.warn("Falha transitória de infraestrutura", { reason: err instanceof Error ? err.message : String(err) });
            return response
                .status(HttpStatus.SERVICE_UNAVAILABLE)
                .set("Retry-After", "1")
                .json({ statusCode: 503, code: "TRANSIENT", message: "Serviço temporariamente indisponível, reenvie a requisição" });
        }

        if (err instanceof DomainError)
        {
            const status = STATUS_BY_CODE[err.code] ?? this.defaultStatus(err);
            if (status >= 500) this.logger.error("Erro de domínio inesperado", { code: err.code }, err);

            return response.status(status).json({ statusCode: status, code: err.code, message: err.message });
        }

        this.logger.error("Erro inesperado", {}, err);
        return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ statusCode: 500, code: "INTERNAL_ERROR", message: "Erro interno" });
    }

    private defaultStatus(err: DomainError): number
    {
        if (err instanceof BusinessError) return HttpStatus.UNPROCESSABLE_ENTITY;
        if (err instanceof PermanentError) return HttpStatus.BAD_REQUEST;
        return HttpStatus.INTERNAL_SERVER_ERROR;
    }

    private isTransientInfrastructureError(err: unknown): boolean
    {
        if (err instanceof ConnectionException || err instanceof DeadlockException || err instanceof LockWaitTimeoutException) return true;

        const code = (err as { code?: string } | null)?.code;
        return typeof code === "string" && ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "57P01", "57P03", "53300"].includes(code);
    }
}