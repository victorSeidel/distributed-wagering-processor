import { defineEntity, p } from "@mikro-orm/core";

export const WalletSchema = defineEntity({
    name: "WalletEntity",
    tableName: "wallets",
    properties: {
        id: p.uuid().primary(),
        playerId: p.string(),

        currency: p.string().length(3),
        balance: p.decimal().precision(18).scale(2),
        version: p.integer().default(1),

        createdAt: p.datetime().onCreate(() => new Date()),
        updatedAt: p.datetime().onCreate(() => new Date()).onUpdate(() => new Date()),
    },
    uniques: [
        { name: "uk_wallets_player_currency", properties: ["playerId", "currency"] },
    ],
    checks: [
        { name: "chk_wallet_balance_positive", expression: "balance >= 0.00" },
        { name: "chk_wallet_currency_format", expression: "currency ~ '^[A-Z]{3}$'" },
    ],
});

export class WalletEntity extends WalletSchema.class {}

WalletSchema.setClass(WalletEntity);