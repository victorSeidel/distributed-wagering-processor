import { defineEntity, p } from "@mikro-orm/core";
import { WagerTransactionType, WagerTransactionStatus, FailureCode } from "../../../domain/wager/wager-transaction";

export const WagerTransactionSchema = defineEntity({
    name: "WagerTransactionEntity",
    tableName: "wager_transactions",
    properties: {
        id: p.uuid().primary(),
        
        providerId: p.string(),
        externalTransactionId: p.string(),
        idempotencyKey: p.string().unique(),
        payloadHash: p.string().length(64),

        walletId: p.uuid().index(),
        playerId: p.string(),

        roundId: p.string(),
        gameId: p.string(),

        type: p.enum(() => WagerTransactionType),

        amount: p.decimal().precision(18).scale(2),
        currency: p.string().length(3),

        referenceExternalTransactionId: p.string().nullable(),
        referenceTransactionId: p.uuid().nullable(),

        status: p.enum(() => WagerTransactionStatus).default(WagerTransactionStatus.Pending).index(),
        failureCode: p.enum(() => FailureCode).nullable(),

        processedAt: p.datetime().nullable(),
        createdAt: p.datetime().onCreate(() => new Date()),
    },
    indexes: [
        { name: "idx_wagers_wallet", properties: ["walletId"] },
        { name: "idx_wagers_status", properties: ["status"] },
        { name: "idx_wagers_reference", properties: ["providerId", "referenceExternalTransactionId"] },
    ]
});

export class WagerTransactionEntity extends WagerTransactionSchema.class {}

WagerTransactionSchema.setClass(WagerTransactionEntity);