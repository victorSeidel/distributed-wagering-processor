/**
 * Redação de campos de log: valores monetários, payloads completos e credenciais nunca saem nos logs.
 * Só primitivos curtos são emitidos; objetos e arrays viram marcadores.
 */
const SENSITIVE_KEY = /(amount|money|balance|payload|body|password|secret|token|authorization|credential|cookie|apikey|document|cpf|email)/i;
const MAX_STRING_LENGTH = 300;

export const REDACTED = "[REDACTED]";

export function sanitizeFields(fields: Record<string, unknown> | undefined): Record<string, unknown>
{
    const sanitized: Record<string, unknown> = {};
    if (!fields) return sanitized;

    for (const [key, value] of Object.entries(fields))
    {
        if (value === undefined) continue;

        if (SENSITIVE_KEY.test(key)) sanitized[key] = REDACTED;
        else sanitized[key] = sanitizeValue(value);
    }

    return sanitized;
}

function sanitizeValue(value: unknown): unknown
{
    if (value === null || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "string") return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return `[array(${value.length})]`;
    return "[object]";
}

export function serializeError(error: unknown, includeStack: boolean): Record<string, unknown>
{
    if (!(error instanceof Error)) return { name: "NonError", message: sanitizeValue(String(error)) };

    const serialized: Record<string, unknown> = { name: error.name, message: sanitizeValue(error.message) };
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") serialized.code = code;
    if (includeStack && error.stack) serialized.stack = error.stack.split("\n").slice(0, 8).join("\n");

    return serialized;
}