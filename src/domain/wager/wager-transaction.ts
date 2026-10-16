import type { Money } from "../shared/money";
import { InvalidInputError, InvalidTransactionStateError } from "../shared/errors";
import { LedgerDirection } from "../wallet/ledger-direction";
import { WagerFailureCode, WagerTransactionKind, WagerTransactionStatus } from "./wager-transaction.types";

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
    kind: WagerTransactionKind;
    money: Money;
    referenceExternalTransactionId?: string;
    createdAt?: Date;
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
    kind: WagerTransactionKind;
    money: Money;
    referenceExternalTransactionId?: string;
    status: WagerTransactionStatus;
    referenceTransactionId?: string;
    failureCode?: WagerFailureCode;
    processedAt?: Date;
    balanceAfter?: Money;
    referenceAttempts: number;
    nextReferenceAttemptAt?: Date;
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
        public readonly kind: WagerTransactionKind,
        public readonly money: Money,
        public readonly referenceExternalTransactionId: string | undefined,
        public readonly createdAt: Date,
        private _status: WagerTransactionStatus,
        private _referenceTransactionId?: string,
        private _failureCode?: WagerFailureCode,
        private _processedAt?: Date,
        private _balanceAfter?: Money,
        private _referenceAttempts: number = 0,
        private _nextReferenceAttemptAt?: Date,
    ) {}

    public static create(props: CreateWagerTransactionProps): WagerTransaction
    {
        const requiresReference = props.kind === WagerTransactionKind.Refund || props.kind === WagerTransactionKind.Rollback;
        if (requiresReference && !props.referenceExternalTransactionId) throw new InvalidInputError(`Operações de ${props.kind} exigem referenceExternalTransactionId`);

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
            props.kind,
            props.money,
            props.referenceExternalTransactionId,
            props.createdAt ?? new Date(),
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
            state.kind,
            state.money,
            state.referenceExternalTransactionId,
            state.createdAt,
            state.status,
            state.referenceTransactionId,
            state.failureCode,
            state.processedAt,
            state.balanceAfter,
            state.referenceAttempts,
            state.nextReferenceAttemptAt,
        );
    }

    public get status(): WagerTransactionStatus { return this._status; }
    public get referenceTransactionId(): string | undefined { return this._referenceTransactionId; }
    public get failureCode(): WagerFailureCode | undefined { return this._failureCode; }
    public get processedAt(): Date | undefined { return this._processedAt; }
    public get balanceAfter(): Money | undefined { return this._balanceAfter; }
    public get referenceAttempts(): number { return this._referenceAttempts; }
    public get nextReferenceAttemptAt(): Date | undefined { return this._nextReferenceAttemptAt; }

    public markProcessed(referenceTransactionId: string | undefined, at: Date): void
    {
        this.assertNotTerminal();
        this._status = WagerTransactionStatus.Processed;
        this._referenceTransactionId = referenceTransactionId;
        this._processedAt = at;
        this._nextReferenceAttemptAt = undefined;
    }

    public markPendingReference(): void
    {
        if (this._status !== WagerTransactionStatus.Pending) throw new InvalidTransactionStateError(`Transição ilegal: ${this._status} → ${WagerTransactionStatus.PendingReference} (transação ${this.id})`);
        this._status = WagerTransactionStatus.PendingReference;
    }

    public reject(code: WagerFailureCode, at: Date = new Date()): void
    {
        this.assertNotTerminal();
        this._status = WagerTransactionStatus.Rejected;
        this._failureCode = code;
        this._processedAt = at;
        this._nextReferenceAttemptAt = undefined;
    }

    public fail(code: WagerFailureCode, at: Date = new Date()): void
    {
        this.assertNotTerminal();
        this._status = WagerTransactionStatus.Failed;
        this._failureCode = code;
        this._processedAt = at;
        this._nextReferenceAttemptAt = undefined;
    }

    public recordBalanceAfter(balance: Money): void
    {
        this._balanceAfter = balance;
    }

    public recordReferenceMiss(nextAttemptAt?: Date): void
    {
        if (this._status !== WagerTransactionStatus.PendingReference) throw new InvalidTransactionStateError(`Somente transações ${WagerTransactionStatus.PendingReference} registram tentativas de referência (transação ${this.id})`);
        this._referenceAttempts += 1;
        this._nextReferenceAttemptAt = nextAttemptAt;
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
        return this.kind !== WagerTransactionKind.Loss && this._status !== WagerTransactionStatus.Rejected;
    }

    public requiresReference(): boolean
    {
        return this.kind === WagerTransactionKind.Refund || this.kind === WagerTransactionKind.Rollback;
    }

    public matchesPayload(payloadHash: string): boolean
    {
        return this.payloadHash === payloadHash;
    }

    public ageMs(now: Date): number
    {
        return now.getTime() - this.createdAt.getTime();
    }

    public evaluateReference(reference: WagerTransaction): WagerFailureCode | undefined
    {
        if (reference.status !== WagerTransactionStatus.Processed) return WagerFailureCode.ReferenceNotProcessed;

        if (reference.playerId !== this.playerId || reference.walletId !== this.walletId ||
            reference.roundId !== this.roundId || reference.money.currency !== this.money.currency)
            return WagerFailureCode.ReferenceMismatch;

        if (!WagerTransaction.allowedReferenceKinds(this.kind).includes(reference.kind)) return WagerFailureCode.InvalidReferenceType;

        if (!reference.money.equals(this.money)) return WagerFailureCode.AmountMismatch;

        return undefined;
    }

    public isReferenceUnresolved(reference: WagerTransaction): boolean
    {
        return reference.status === WagerTransactionStatus.Pending || reference.status === WagerTransactionStatus.PendingReference;
    }

    public ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection
    {
        switch (this.kind)
        {
            case WagerTransactionKind.Opening:
            case WagerTransactionKind.Win:
            case WagerTransactionKind.Refund:
                return LedgerDirection.Credit;

            case WagerTransactionKind.Bet:
                return LedgerDirection.Debit;

            case WagerTransactionKind.Rollback:
            {
                if (!reference) throw new InvalidTransactionStateError("Rollback exige a transação de referência para derivar a direção contábil");

                return reference.ledgerDirectionFor() === LedgerDirection.Debit ? LedgerDirection.Credit : LedgerDirection.Debit;
            }

            case WagerTransactionKind.Loss:
                throw new InvalidTransactionStateError("Transações do tipo LOSS não geram movimentação contábil no ledger");
        }
    }

    private static allowedReferenceKinds(kind: WagerTransactionKind): WagerTransactionKind[]
    {
        switch (kind)
        {
            case WagerTransactionKind.Refund: return [WagerTransactionKind.Bet];
            case WagerTransactionKind.Rollback: return [WagerTransactionKind.Bet, WagerTransactionKind.Win, WagerTransactionKind.Refund];
            default: return [];
        }
    }

    private assertNotTerminal(): void
    {
        if (this.isTerminal()) throw new InvalidTransactionStateError(`Transição ilegal: transação ${this.id} já se encontra no estado terminal ${this._status}`);
    }
}