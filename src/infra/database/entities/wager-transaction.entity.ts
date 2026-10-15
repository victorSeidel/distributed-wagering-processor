import { defineEntity, p } from "@mikro-orm/core";
import { WagerFailureCode, WagerTransactionKind, WagerTransactionStatus } from "../../../model/entity/wager.entity";

export const WagerTransactionSchema = defineEntity({
    name: "WagerTransactionEntity",
    tableName: "wager_transactions",
    properties: {
        id: p.uuid().primary(),
        providerId: p.string(),
        walletId: p.uuid().index(),

        externalTransactionId: p.string(),
        referenceExternalTransactionId: p.string().nullable(),
        referenceTransactionId: p.uuid().nullable(),

        playerId: p.string(),
        roundId: p.string(),
        gameId: p.string(),

        idempotencyKey: p.string().unique(),
        payloadHash: p.string().length(64),
        kind: p.enum(() => WagerTransactionKind),

        amount: p.decimal().precision(18).scale(2),
        currency: p.string().length(3),

        status: p.enum(() => WagerTransactionStatus).default(WagerTransactionStatus.Pending).index(),
        failureCode: p.enum(() => WagerFailureCode).nullable(),

        processedAt: p.datetime().nullable(),
        createdAt: p.datetime().onCreate(() => new Date()),
    },
    uniques: [
        { name: "uq_wagers_provider_external_tx", properties: ["providerId", "externalTransactionId"] },
    ],
    indexes: [
        { name: "idx_wagers_reference", properties: ["providerId", "referenceExternalTransactionId"] },
        { name: "idx_wagers_wallet", properties: ["walletId"] },
        { name: "idx_wagers_status", properties: ["status"] },
        {
            name: "uq_wagers_single_reversal_per_reference",
            properties: ["referenceTransactionId", "kind"],
            expression:
                `create unique index "uq_wagers_single_reversal_per_reference" ` +
                `on "wager_transactions" ("reference_transaction_id", "kind") ` +
                `where "status" = 'PROCESSED' and "kind" in ('REFUND', 'ROLLBACK')`,
        },
    ]
});

export class WagerTransactionEntity extends WagerTransactionSchema.class {}

WagerTransactionSchema.setClass(WagerTransactionEntity);