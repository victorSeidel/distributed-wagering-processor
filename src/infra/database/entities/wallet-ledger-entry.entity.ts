import { defineEntity, p } from "@mikro-orm/core";
import { LedgerDirection } from "../../../model/type/wallet.type";

export const WalletLedgerEntrySchema = defineEntity({
    name: "WalletLedgerEntryEntity",
    tableName: "wallet_ledger_entries",
    properties: {
        id: p.uuid().primary(),
        walletId: p.uuid().index(),
        transactionId: p.uuid().unique(),

        direction: p.enum(() => LedgerDirection),

        amount: p.decimal().precision(18).scale(2),
        currency: p.string().length(3),

        balanceBefore: p.decimal().precision(18).scale(2),
        balanceAfter: p.decimal().precision(18).scale(2),

        createdAt: p.datetime().onCreate(() => new Date()).index(),
    },
    indexes: [
        { name: "idx_ledger_wallet_created", properties: ["walletId", "createdAt"] },
    ],
    triggers: [
        {
            name: "trg_protect_ledger",
            timing: "before",
            events: ["update", "delete"],
            body: `RAISE EXCEPTION 'Lançamentos contábeis no ledger são estritamente imutáveis. Operações de UPDATE ou DELETE são proibidas'; RETURN OLD;`,
        },
    ]
});

export class WalletLedgerEntryEntity extends WalletLedgerEntrySchema.class {}

WalletLedgerEntrySchema.setClass(WalletLedgerEntryEntity);