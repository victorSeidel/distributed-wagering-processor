export enum WagerTransactionKind
{
    Opening = "OPENING",
    Bet = "BET",
    Win = "WIN",
    Loss = "LOSS",
    Refund = "REFUND",
    Rollback = "ROLLBACK",
}

export enum WagerTransactionStatus
{
    Pending = "PENDING",
    PendingReference = "PENDING_REFERENCE",
    Processed = "PROCESSED",
    Rejected = "REJECTED",
    Failed = "FAILED",
}

export enum WagerFailureCode
{
    InsufficientFunds = "INSUFFICIENT_FUNDS",
    ReferenceNotFound = "REFERENCE_NOT_FOUND",
    ReferenceAlreadyReversed = "REFERENCE_ALREADY_REVERSED",
    InvalidReferenceType = "INVALID_REFERENCE_TYPE",
    InvalidCurrency = "INVALID_CURRENCY",
    ReversalWouldProduceNegativeBalance = "REVERSAL_WOULD_PRODUCE_NEGATIVE_BALANCE",
    AmountMismatch = "AMOUNT_MISMATCH",
    IdempotencyConflict = "IDEMPOTENCY_CONFLICT",
}