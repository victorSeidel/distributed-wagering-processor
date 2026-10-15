export abstract class BusinessError extends Error
{
    abstract readonly code: string;
    abstract readonly httpStatus: number;
}

export abstract class PermanentError extends Error
{
    abstract readonly code: string;
}

export class TransientError extends Error
{
    readonly code = "TRANSIENT";
}

export class IdempotencyConflictError extends BusinessError
{
    readonly code = "IDEMPOTENCY_CONFLICT";
    readonly httpStatus = 409;
    constructor(idempotencyKey: string) { super(`A chave '${idempotencyKey}' já foi utilizada com outro payload`); }
}

export class WalletNotFoundError extends BusinessError
{
    readonly code = "WALLET_NOT_FOUND";
    readonly httpStatus = 404;
    constructor(walletId: string) { super(`Wallet '${walletId}' não encontrada`); }
}

export class CurrencyMismatchError extends BusinessError
{
    readonly code = "CURRENCY_MISMATCH";
    readonly httpStatus = 409;
    constructor(input: string, wallet: string) { super(`Moeda (${input}) não corresponde à carteira (${wallet})`); }
}

export class InvalidMessageError extends PermanentError
{
    readonly code = "INVALID_MESSAGE";
    constructor(reason: string) { super(reason); }
}

export class InboxPayloadMismatchError extends PermanentError
{
    readonly code = "INBOX_PAYLOAD_MISMATCH";
    constructor(consumerName: string, messageId: string)
    {
        super(`Inbox ${consumerName}/${messageId} reentregue com payload diferente do original`);
        this.name = "InboxPayloadMismatchError";
    }
}