import { Money } from "../../../domain/shared/money";
import { WagerTransaction } from "../../../domain/wager/wager-transaction";
import { WagerTransactionEntity } from "../entities/wager-transaction.entity";

export class WagerTransactionMapper
{
    public static toDomain(entity: WagerTransactionEntity): WagerTransaction
    {
        return WagerTransaction.rehydrate({
            id: entity.id,
            providerId: entity.providerId,
            externalTransactionId: entity.externalTransactionId,
            idempotencyKey: entity.idempotencyKey,
            payloadHash: entity.payloadHash,
            walletId: entity.walletId,
            playerId: entity.playerId,
            roundId: entity.roundId,
            gameId: entity.gameId,
            kind: entity.kind,
            money: Money.from({ amount: entity.amount, currency: entity.currency }),
            referenceExternalTransactionId: entity.referenceExternalTransactionId ?? undefined,
            referenceTransactionId: entity.referenceTransactionId ?? undefined,
            status: entity.status,
            failureCode: entity.failureCode ?? undefined,
            processedAt: entity.processedAt ?? undefined,
            balanceAfter: entity.balanceAfter ? Money.from({ amount: entity.balanceAfter, currency: entity.currency }) : undefined,
            referenceAttempts: entity.referenceAttempts,
            nextReferenceAttemptAt: entity.referenceNextAttemptAt ?? undefined,
            createdAt: entity.createdAt,
        });
    }

    public static toEntity(domain: WagerTransaction): WagerTransactionEntity
    {
        const entity = new WagerTransactionEntity();
        entity.id = domain.id;
        entity.providerId = domain.providerId;
        entity.externalTransactionId = domain.externalTransactionId;
        entity.idempotencyKey = domain.idempotencyKey;
        entity.payloadHash = domain.payloadHash;
        entity.walletId = domain.walletId;
        entity.playerId = domain.playerId;
        entity.roundId = domain.roundId;
        entity.gameId = domain.gameId;
        entity.kind = domain.kind;
        entity.amount = domain.money.toString();
        entity.currency = domain.money.currency;
        entity.referenceExternalTransactionId = domain.referenceExternalTransactionId;
        entity.createdAt = domain.createdAt;
        WagerTransactionMapper.apply(entity, domain);
        return entity;
    }

    public static apply(entity: WagerTransactionEntity, domain: WagerTransaction): void
    {
        entity.status = domain.status;
        entity.failureCode = domain.failureCode ?? null;
        entity.referenceTransactionId = domain.referenceTransactionId ?? null;
        entity.processedAt = domain.processedAt ?? null;
        entity.balanceAfter = domain.balanceAfter?.toString() ?? null;
        entity.referenceAttempts = domain.referenceAttempts;
        entity.referenceNextAttemptAt = domain.nextReferenceAttemptAt ?? null;
    }
}