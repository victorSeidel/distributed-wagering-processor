import { Money } from "../common/money";

import type { CreateWagerTransactionDto, WagerTransactionState } from "../../model/dto/wager.dto";
import { WagerTransactionKind, type WagerFailureCode, WagerTransactionStatus } from "../../model/entity/wager.entity";
import { LedgerDirection } from "../../model/type/wallet.type";

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
    ) {}

    public static create(dto: CreateWagerTransactionDto): WagerTransaction
    {
        if ((dto.kind === WagerTransactionKind.Refund || dto.kind === WagerTransactionKind.Rollback) && !dto.referenceExternalTransactionId)
            throw new Error(`Operações de ${dto.kind} exigem referenceExternalTransactionId`);

        return new WagerTransaction(
            dto.id,
            dto.providerId,
            dto.externalTransactionId,
            dto.idempotencyKey,
            dto.payloadHash,
            dto.walletId,
            dto.playerId,
            dto.roundId,
            dto.gameId,
            dto.kind,
            dto.money,
            dto.referenceExternalTransactionId,
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
            state.kind,
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
    public get failureCode(): WagerFailureCode | undefined { return this._failureCode; }
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

    public reject(code: WagerFailureCode): void
    {
        this.assertNotTerminal();
        this._status = WagerTransactionStatus.Rejected;
        this._failureCode = code;
        this._processedAt = new Date();
    }

    public fail(code: WagerFailureCode): void
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
                if (!reference) throw new Error("Rollback exige a transação de referência para derivar a direção contábil");

                const refDir = reference.ledgerDirectionFor();
                return refDir === LedgerDirection.Debit ? LedgerDirection.Credit : LedgerDirection.Debit;
            }

            case WagerTransactionKind.Loss:
                throw new Error("Transações do tipo LOSS não geram movimentação contábil no ledger");
        }
    }

    private assertNotTerminal(): void
    {
        if (this.isTerminal()) throw new Error(`Transição ilegal: transação ${this.id} já se encontra no estado terminal ${this._status}`);
    }
}