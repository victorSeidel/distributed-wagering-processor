import { defineEntity, p } from "@mikro-orm/core";
import { LedgerDirection } from "../../../model/type/wallet.type";
import { WalletSchema } from "./wallet.entity";
import { WagerTransactionSchema } from "./wager-transaction.entity";

export const WalletLedgerEntrySchema = defineEntity({
    name: "WalletLedgerEntryEntity",
    tableName: "wallet_ledger_entries",
    properties: {
        id: p.uuid().primary(),
        wallet: p.manyToOne(WalletSchema).fieldName("wallet_id").ref().deleteRule("restrict"),
        transaction: p.manyToOne(WagerTransactionSchema).fieldName("transaction_id").ref().unique().deleteRule("restrict"),

        direction: p.enum(() => LedgerDirection),

        amount: p.decimal().precision(18).scale(2),
        currency: p.string().length(3),

        balanceBefore: p.decimal().precision(18).scale(2),
        balanceAfter: p.decimal().precision(18).scale(2),

        createdAt: p.datetime().onCreate(() => new Date()).index(),
    },
    uniques: [
        { name: "uq_ledger_transaction", properties: ["transaction"] },
    ],
    indexes: [
        { name: "idx_ledger_wallet", properties: ["wallet"] },
        { name: "idx_ledger_wallet_created", properties: ["wallet", "createdAt"] },
    ],
    checks: [
        { name: "chk_ledger_amount_positive", expression: "amount > 0" },
        { name: "chk_ledger_balance_before_non_negative", expression: "balance_before >= 0" },
        { name: "chk_ledger_balance_after_non_negative", expression: "balance_after >= 0" },
        {
            name: "chk_ledger_balance_arithmetic",
            expression: `(direction = 'CREDIT' and balance_after = balance_before + amount) or (direction = 'DEBIT' and balance_after = balance_before - amount)`,
        },
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