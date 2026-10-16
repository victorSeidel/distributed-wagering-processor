export abstract class DomainError extends Error
{
    abstract readonly code: string;

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
}

export class InvalidInputError extends PermanentError
{
    readonly code = "INVALID_INPUT";
}

export class InvalidTransactionStateError extends PermanentError
{
    readonly code = "INVALID_TRANSACTION_STATE";
}

export class LedgerInvariantError extends PermanentError
{
    readonly code = "LEDGER_INVARIANT_VIOLATED";
}

export class CurrencyMismatchError extends BusinessError
{
    readonly code = "CURRENCY_MISMATCH";

    constructor(input: string, wallet: string)
    {
        super(`Moeda (${input}) não corresponde à carteira (${wallet})`);
    }
}

export class CurrencyConflictError extends BusinessError
{
    readonly code = "CURRENCY_CONFLICT";
}

export class InsufficientFundsError extends BusinessError
{
    readonly code = "INSUFFICIENT_FUNDS";
}