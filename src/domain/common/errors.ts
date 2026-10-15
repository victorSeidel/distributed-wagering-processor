export abstract class DomainError extends Error
{
    abstract readonly code: string;
    abstract readonly httpStatus: number;

    constructor(message: string)
    {
        super(message);
        this.name = new.target.name;
    }
}

export abstract class BusinessError extends DomainError {}

export abstract class PermanentError extends DomainError {}

export class TransientError extends DomainError
{
    readonly code = "TRANSIENT";
    readonly httpStatus = 503;
}

export class InvalidInputError extends PermanentError
{
    readonly code = "INVALID_INPUT";
    readonly httpStatus = 400;
}

export class InvalidMessageError extends PermanentError
{
    readonly code = "INVALID_MESSAGE";
    readonly httpStatus = 400;
}

export class InboxPayloadMismatchError extends PermanentError
{
    readonly code = "INBOX_PAYLOAD_MISMATCH";
    readonly httpStatus = 422;
    constructor(consumerName: string, messageId: string)
    {
        super(`Inbox ${consumerName}/${messageId} reentregue com payload diferente do original`);
    }
}

export class InvalidTransactionStateError extends PermanentError
{
    readonly code = "INVALID_TRANSACTION_STATE";
    readonly httpStatus = 500;
}

export class LedgerInvariantError extends PermanentError
{
    readonly code = "LEDGER_INVARIANT_VIOLATED";
    readonly httpStatus = 500;
}

export class IdempotencyConflictError extends BusinessError
{
    readonly code = "IDEMPOTENCY_CONFLICT";
    readonly httpStatus = 409;
    constructor(idempotencyKey: string) { super(`A chave '${idempotencyKey}' já foi utilizada com outro payload`); }
}

export class DuplicateExternalTransactionError extends BusinessError
{
    readonly code = "DUPLICATE_EXTERNAL_TRANSACTION";
    readonly httpStatus = 409;
    constructor(providerId: string, externalTransactionId: string)
    {
        super(`A transação '${externalTransactionId}' do provedor '${providerId}' já foi registrada com outra Idempotency-Key`);
    }
}

export class WalletNotFoundError extends BusinessError
{
    readonly code = "WALLET_NOT_FOUND";
    readonly httpStatus = 404;
    constructor(walletId: string) { super(`Wallet '${walletId}' não encontrada`); }
}

export class TransactionNotFoundError extends BusinessError
{
    readonly code = "TRANSACTION_NOT_FOUND";
    readonly httpStatus = 404;
}

export class WalletAlreadyExistsError extends BusinessError
{
    readonly code = "WALLET_ALREADY_EXISTS";
    readonly httpStatus = 409;
    constructor(playerId: string, currency: string) { super(`Wallet já existente para o jogador ${playerId} com moeda ${currency}`); }
}

export class CurrencyMismatchError extends BusinessError
{
    readonly code = "CURRENCY_MISMATCH";
    readonly httpStatus = 409;
    constructor(input: string, wallet: string) { super(`Moeda (${input}) não corresponde à carteira (${wallet})`); }
}

export class CurrencyConflictError extends BusinessError
{
    readonly code = "CURRENCY_CONFLICT";
    readonly httpStatus = 409;
}

export class InsufficientFundsError extends BusinessError
{
    readonly code = "INSUFFICIENT_FUNDS";
    readonly httpStatus = 422;
}