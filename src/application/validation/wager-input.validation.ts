import { Money } from "../../domain/common/money";
import { InvalidInputError } from "../../domain/common/errors";

import { WagerTransactionKind } from "../../model/entity/wager.entity";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT_LENGTH = 255;

const SUBMITTABLE_KINDS: readonly string[] =
[
    WagerTransactionKind.Bet,
    WagerTransactionKind.Win,
    WagerTransactionKind.Loss,
    WagerTransactionKind.Refund,
    WagerTransactionKind.Rollback,
];

export function isUuid(value: unknown): value is string
{
    return typeof value === "string" && UUID_PATTERN.test(value);
}

export function assertUuid(value: unknown, field: string): string
{
    if (!isUuid(value)) throw new InvalidInputError(`Campo '${field}' deve ser um UUID válido`);
    return value;
}

export function assertText(value: unknown, field: string): string
{
    if (typeof value !== "string" || value.trim().length === 0) throw new InvalidInputError(`Campo '${field}' é obrigatório e deve ser uma string não vazia`);
    if (value.length > MAX_TEXT_LENGTH) throw new InvalidInputError(`Campo '${field}' excede ${MAX_TEXT_LENGTH} caracteres`);
    return value;
}

export function assertObject(value: unknown, field: string): Record<string, unknown>
{
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new InvalidInputError(`'${field}' deve ser um objeto`);
    return value as Record<string, unknown>;
}

export function validateWagerSubmission(input: unknown): Money
{
    const body = assertObject(input, "body");

    assertText(body.providerId, "providerId");
    assertText(body.externalTransactionId, "externalTransactionId");
    assertText(body.idempotencyKey, "idempotencyKey");
    assertText(body.playerId, "playerId");
    assertText(body.roundId, "roundId");
    assertText(body.gameId, "gameId");
    assertUuid(body.walletId, "walletId");

    const kind = body.kind;
    if (kind === WagerTransactionKind.Opening) throw new InvalidInputError("O tipo OPENING é interno e não pode ser submetido");
    if (typeof kind !== "string" || !SUBMITTABLE_KINDS.includes(kind)) throw new InvalidInputError(`Campo 'kind' deve ser um de: ${SUBMITTABLE_KINDS.join(", ")}`);

    const reference = body.referenceExternalTransactionId;
    const requiresReference = kind === WagerTransactionKind.Refund || kind === WagerTransactionKind.Rollback;

    if (requiresReference) assertText(reference, "referenceExternalTransactionId");
    else if (reference !== undefined && reference !== null) throw new InvalidInputError(`Operações ${kind} não aceitam referenceExternalTransactionId`);

    const moneyBody = assertObject(body.money, "money");
    const money = Money.from({ amount: moneyBody.amount as string, currency: moneyBody.currency as string });
    if (!money.isPositive()) throw new InvalidInputError("O valor da transação deve ser maior que zero");

    return money;
}