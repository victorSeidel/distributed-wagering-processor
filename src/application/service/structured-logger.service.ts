import { Injectable, type LoggerService } from "@nestjs/common";

export interface LogContext
{
    correlationId?: string;
    messageId?: string;
    transactionId?: string;
    walletId?: string;
    providerId?: string;
    [key: string]: unknown;
}

@Injectable()
export class StructuredLogger implements LoggerService
{
    private formatLog(level: string, message: string, context?: LogContext)
    {
        const logEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            correlationId: context?.correlationId,
            messageId: context?.messageId,
            transactionId: context?.transactionId,
            walletId: context?.walletId,
            providerId: context?.providerId,
        };

        return JSON.stringify(logEntry);
    }

    log(message: string, context?: LogContext)
    {
        console.log(this.formatLog("INFO", message, context));
    }

    error(message: string, trace?: string, context?: LogContext)
    {
        console.error(this.formatLog("ERROR", message, { ...context, trace }));
    }

    warn(message: string, context?: LogContext)
    {
        console.warn(this.formatLog("WARN", message, context));
    }

    debug(message: string, context?: LogContext)
    {
        if (process.env.NODE_ENV === "production") return;
        console.debug(this.formatLog("DEBUG", message, context));
    }
}