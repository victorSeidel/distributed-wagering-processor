import { Money } from "../common/money";
import { LedgerDirection } from "../wallet/wallet-ledger-entry";

export enum WagerTransactionType
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

export enum FailureCode
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

export interface CreateWagerTransactionProps
{
    id: string;
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    payloadHash: string;
    walletId: string;
    playerId: string;
    roundId: string;
    gameId: string;
    type: WagerTransactionType;
    money: Money;
    referenceExternalTransactionId?: string;
}

export interface WagerTransactionState
{
    id: string;
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    payloadHash: string;
    walletId: string;
    playerId: string;
    roundId: string;
    gameId: string;
    type: WagerTransactionType;
    money: Money;
    referenceExternalTransactionId?: string;
    status: WagerTransactionStatus;
    referenceTransactionId?: string;
    failureCode?: FailureCode;
    processedAt?: Date;
    createdAt: Date;
}

export class WagerTransaction
{
    private constructor(
        public readonly id: string,
        public readonly providerId: string,
        public readonly externalTransactionId: string,
        public readonly idempotencyKey: string,
        public readonly payloadHash: string,
        public readonly walletId: string,
        public readonly playerId: string,
        public readonly roundId: string,
        public readonly gameId: string,
        public readonly type: WagerTransactionType,
        public readonly money: Money,
        public readonly referenceExternalTransactionId: string | undefined,
        public readonly createdAt: Date,
        private _status: WagerTransactionStatus,
        private _referenceTransactionId?: string,
        private _failureCode?: FailureCode,
        private _processedAt?: Date,
    ) {}

    public static create(props: CreateWagerTransactionProps): WagerTransaction
    {
        if ((props.type === WagerTransactionType.Refund || props.type === WagerTransactionType.Rollback) && !props.referenceExternalTransactionId)
            throw new Error(`Operações de ${props.type} exigem referenceExternalTransactionId`);

        return new WagerTransaction(
            props.id,
            props.providerId,
            props.externalTransactionId,
            props.idempotencyKey,
            props.payloadHash,
            props.walletId,
            props.playerId,
            props.roundId,
            props.gameId,
            props.type,
            props.money,
            props.referenceExternalTransactionId,
            new Date(),
            WagerTransactionStatus.Pending,
        );
    }

    public static rehydrate(state: WagerTransactionState): WagerTransaction
    {
        return new WagerTransaction(
            state.id,
            state.providerId,
            state.externalTransactionId,
            state.idempotencyKey,
            state.payloadHash,
            state.walletId,
            state.playerId,
            state.roundId,
            state.gameId,
            state.type,
            state.money,
            state.referenceExternalTransactionId,
            state.createdAt,
            state.status,
            state.referenceTransactionId,
            state.failureCode,
            state.processedAt,
        );
    }

    public get status(): WagerTransactionStatus { return this._status; }
    public get referenceTransactionId(): string | undefined { return this._referenceTransactionId; }
    public get failureCode(): FailureCode | undefined { return this._failureCode; }
    public get processedAt(): Date | undefined { return this._processedAt; }

    public markProcessed(referenceTransactionId: string | undefined, at: Date): void
    {
        this.assertNotTerminal();
        this._status = WagerTransactionStatus.Processed;
        this._referenceTransactionId = referenceTransactionId;
        this._processedAt = at;
    }

    public markPendingReference(): void
    {
        this.assertNotTerminal();
        this._status = WagerTransactionStatus.PendingReference;
    }

    public reject(code: FailureCode): void
    {
        this.assertNotTerminal();
        this._status = WagerTransactionStatus.Rejected;
        this._failureCode = code;
        this._processedAt = new Date();
    }

    public fail(code: FailureCode): void
    {
        this.assertNotTerminal();
        this._status = WagerTransactionStatus.Failed;
        this._failureCode = code;
        this._processedAt = new Date();
    }

    public isTerminal(): boolean
    {
        return (
            this._status === WagerTransactionStatus.Processed ||
            this._status === WagerTransactionStatus.Rejected ||
            this._status === WagerTransactionStatus.Failed
        );
    }

    public affectsBalance(): boolean
    {
        return this.type !== WagerTransactionType.Loss && this._status !== WagerTransactionStatus.Rejected;
    }

    public requiresReference(): boolean
    {
        return this.type === WagerTransactionType.Refund || this.type === WagerTransactionType.Rollback;
    }

    public matchesPayload(payloadHash: string): boolean
    {
        return this.payloadHash === payloadHash;
    }

    public ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection
    {
        switch (this.type)
        {
            case WagerTransactionType.Opening:
            case WagerTransactionType.Win:
            case WagerTransactionType.Refund:
                return LedgerDirection.Credit;

            case WagerTransactionType.Bet:
                return LedgerDirection.Debit;

            case WagerTransactionType.Rollback:
            {
                if (!reference) throw new Error("Rollback exige a transação de referência para derivar a direção contábil");

                const refDir = reference.ledgerDirectionFor();
                return refDir === LedgerDirection.Debit ? LedgerDirection.Credit : LedgerDirection.Debit;
            }

            case WagerTransactionType.Loss:
                throw new Error("Transações do tipo LOSS não geram movimentação contábil no ledger");
        }
    }

    private assertNotTerminal(): void
    {
        if (this.isTerminal()) throw new Error(`Transição ilegal: transação ${this.id} já se encontra no estado terminal ${this._status}`);
    }
}