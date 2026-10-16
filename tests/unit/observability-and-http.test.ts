import { describe, expect, it } from "bun:test";

import { InsufficientFundsError, InvalidInputError, TransientError } from "../../src/domain/shared/errors";
import { WalletNotFoundError, IdempotencyConflictError } from "../../src/application/errors";
import type { AppLogger } from "../../src/application/ports/observability.port";
import { sanitizeFields, serializeError, REDACTED } from "../../src/infra/observability/log-redaction";
import { GlobalExceptionFilter } from "../../src/infra/http/filters/global-exception.filter";

describe("Logs: redação de dados sensíveis", () =>
{
    it("Valores monetários, payloads e credenciais são redigidos; identificadores operacionais são preservados", () =>
    {
        const fields = sanitizeFields({
            walletId: "w-1",
            transactionId: "t-1",
            amount: "25.00",
            balanceAfter: "975.00",
            payload: { money: "25.00" },
            authorization: "Bearer abc",
            email: "a@b.com",
        });

        expect(fields.walletId).toBe("w-1");
        expect(fields.transactionId).toBe("t-1");
        expect(fields.amount).toBe(REDACTED);
        expect(fields.balanceAfter).toBe(REDACTED);
        expect(fields.payload).toBe(REDACTED);
        expect(fields.authorization).toBe(REDACTED);
        expect(fields.email).toBe(REDACTED);
    });

    it("Objetos aninhados não vazam: viram marcador e strings longas são truncadas", () =>
    {
        const fields = sanitizeFields({ nested: { secret: 1 }, list: [1, 2], long: "x".repeat(1000) });

        expect(fields.nested).toBe("[object]");
        expect(fields.list).toBe("[array(2)]");
        expect(String(fields.long).length).toBeLessThanOrEqual(301);
    });

    it("Stack trace só é incluída quando solicitada", () =>
    {
        const err = new Error("falha");
        expect(serializeError(err, false).stack).toBeUndefined();
        expect(typeof serializeError(err, true).stack).toBe("string");
    });
});

describe("HTTP: mapeamento consistente de erros", () =>
{
    function run(error: unknown): { status: number; body: Record<string, unknown>; headers: Record<string, string> }
    {
        const captured = { status: 0, body: {} as Record<string, unknown>, headers: {} as Record<string, string> };
        const response = {
            status(code: number) { captured.status = code; return this; },
            set(name: string, value: string) { captured.headers[name] = value; return this; },
            json(body: Record<string, unknown>) { captured.body = body; return this; },
        };
        const host = { switchToHttp: () => ({ getResponse: () => response }) };

        const logger = { info() {}, warn() {}, error() {} } as unknown as AppLogger;
        new GlobalExceptionFilter(logger).catch(error, host as never);

        return captured;
    }

    it("Entrada inválida -> 400", () =>
    {
        const r = run(new InvalidInputError("campo ausente"));
        expect(r.status).toBe(400);
        expect(r.body.code).toBe("INVALID_INPUT");
    });

    it("Recurso inexistente -> 404", () =>
    {
        expect(run(new WalletNotFoundError("w")).status).toBe(404);
    });

    it("Conflito de idempotência -> 409", () =>
    {
        const r = run(new IdempotencyConflictError("k"));
        expect(r.status).toBe(409);
        expect(r.body.code).toBe("IDEMPOTENCY_CONFLICT");
    });

    it("Regra de negócio (saldo insuficiente) -> 422", () =>
    {
        expect(run(new InsufficientFundsError("sem saldo")).status).toBe(422);
    });

    it("Falha transitória de infraestrutura -> 503 com Retry-After", () =>
    {
        const r = run(new TransientError("banco indisponível"));
        expect(r.status).toBe(503);
        expect(r.headers["Retry-After"]).toBe("1");
    });

    it("Erro inesperado -> 500 sem vazar a mensagem interna", () =>
    {
        const r = run(new Error("detalhe interno sensível"));
        expect(r.status).toBe(500);
        expect(r.body.code).toBe("INTERNAL_ERROR");
        expect(JSON.stringify(r.body)).not.toContain("sensível");
    });
});