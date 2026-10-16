import { BusinessError, PermanentError } from "../domain/shared/errors";

export class IdempotencyConflictError extends BusinessError
{
    readonly code = "IDEMPOTENCY_CONFLICT";

    constructor(idempotencyKey: string)
    {
        super(`A chave '${idempotencyKey}' já foi utilizada com outro payload`);
    }
}

export class DuplicateExternalTransactionError extends BusinessError
{
    readonly code = "DUPLICATE_EXTERNAL_TRANSACTION";

    constructor(providerId: string, externalTransactionId: string)
    {
        super(`A transação '${externalTransactionId}' do provedor '${providerId}' já foi registrada com outra Idempotency-Key`);
    }
}

export class WalletNotFoundError extends BusinessError
{
    readonly code = "WALLET_NOT_FOUND";

    constructor(walletId: string)
    {
        super(`Wallet '${walletId}' não encontrada`);
    }
}

export class TransactionNotFoundError extends BusinessError
{
    readonly code = "TRANSACTION_NOT_FOUND";
}

export class WalletAlreadyExistsError extends BusinessError
{
    readonly code = "WALLET_ALREADY_EXISTS";

    constructor(playerId: string, currency: string)
    {
        super(`Wallet já existente para o jogador ${playerId} com moeda ${currency}`);
    }
}

export class InvalidMessageError extends PermanentError
{
    readonly code = "INVALID_MESSAGE";
}

export class InboxPayloadMismatchError extends PermanentError
{
    readonly code = "INBOX_PAYLOAD_MISMATCH";

    constructor(consumerName: string, messageId: string)
    {
        super(`Inbox ${consumerName}/${messageId} reentregue com payload diferente do original`);
    }
}

export class UniqueViolationError extends BusinessError
{
    readonly code = "UNIQUE_VIOLATION";

    constructor(public readonly constraint: string)
    {
        super(`Violação da constraint de unicidade '${constraint}'`);
    }
}