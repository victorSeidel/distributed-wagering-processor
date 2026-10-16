import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { v7 as uuidv7 } from "uuid";

import { createTestContext, type TestContext } from "../support/test-context";

import { WalletAlreadyExistsError } from "../../src/application/errors";

describe("Integração: constraints e triggers do PostgreSQL", () =>
{
    let ctx: TestContext;

    beforeAll(async () =>
    {
        ctx = await createTestContext();
    });

    afterAll(async () =>
    {
        await ctx.close();
    });

    const sql = (query: string, params: unknown[] = []) => ctx.orm.em.fork().execute(query, params);

    it("Saldo negativo é rejeitado pelo CHECK (chk_wallet_balance_positive)", async () =>
    {
        const wallet = await ctx.openWallet.execute({ playerId: uuidv7(), initialBalance: { amount: "10.00", currency: "BRL" } });

        await expect(sql("update wallets set balance = -0.01 where id = ?", [wallet.id])).rejects.toThrow(/chk_wallet_balance_positive/);
    });

    it("Moeda fora do formato ISO é rejeitada (chk_wallet_currency_format)", async () =>
    {
        const wallet = await ctx.openWallet.execute({ playerId: uuidv7(), initialBalance: { amount: "10.00", currency: "BRL" } });

        await expect(sql("update wallets set currency = 'br1' where id = ?", [wallet.id])).rejects.toThrow(/chk_wallet_currency_format/);
    });

    it("Duas wallets para o mesmo jogador e moeda são impedidas pelo UNIQUE, mesmo sem a checagem da aplicação", async () =>
    {
        const playerId = uuidv7();
        const wallet = await ctx.openWallet.execute({ playerId, initialBalance: { amount: "10.00", currency: "BRL" } });

        await expect(sql(
            "insert into wallets (id, player_id, currency, balance, version, created_at, updated_at) values (?, ?, 'BRL', 0, 1, now(), now())",
            [uuidv7(), wallet.playerId],
        )).rejects.toThrow(/uk_wallets_player_currency/);

        await expect(ctx.openWallet.execute({ playerId, initialBalance: { amount: "1.00", currency: "BRL" } })).rejects.toThrow(WalletAlreadyExistsError);
    });

    it("Valor de transação não positivo é rejeitado (chk_wager_amount_positive)", async () =>
    {
        const wallet = await ctx.openWallet.execute({ playerId: uuidv7(), initialBalance: { amount: "10.00", currency: "BRL" } });
        const opening = (await sql("select id from wager_transactions where wallet_id = ? limit 1", [wallet.id]))[0];

        await expect(sql("update wager_transactions set amount = 0 where id = ?", [opening?.id])).rejects.toThrow(/chk_wager_amount_positive/);
    });

    it("Um único lançamento de ledger por transação (uq_ledger_transaction), mesmo com SQL direto", async () =>
    {
        const wallet = await ctx.openWallet.execute({ playerId: uuidv7(), initialBalance: { amount: "10.00", currency: "BRL" } });
        const [entry] = await sql("select transaction_id from wallet_ledger_entries where wallet_id = ?", [wallet.id]);

        await expect(sql(
            `insert into wallet_ledger_entries (id, wallet_id, transaction_id, direction, amount, currency, balance_before, balance_after, created_at)
             values (?, ?, ?, 'CREDIT', 10.00, 'BRL', 0, 10.00, now())`,
            [uuidv7(), wallet.id, entry?.transaction_id],
        )).rejects.toThrow(/uq_ledger_transaction/);
    });

    it("Trigger impede UPDATE de lançamento do ledger", async () =>
    {
        const wallet = await ctx.openWallet.execute({ playerId: uuidv7(), initialBalance: { amount: "100.00", currency: "BRL" } });

        await expect(sql("update wallet_ledger_entries set amount = 999.00 where wallet_id = ?", [wallet.id])).rejects.toThrow(/imutáveis/);
    });

    it("Trigger impede DELETE de lançamento do ledger", async () =>
    {
        const wallet = await ctx.openWallet.execute({ playerId: uuidv7(), initialBalance: { amount: "50.00", currency: "BRL" } });

        await expect(sql("delete from wallet_ledger_entries where wallet_id = ?", [wallet.id])).rejects.toThrow(/imutáveis/);
    });

    it("Ledger preserva o lançamento original após tentativa de alteração", async () =>
    {
        const wallet = await ctx.openWallet.execute({ playerId: uuidv7(), initialBalance: { amount: "100.00", currency: "BRL" } });
        await sql("update wallet_ledger_entries set amount = 999.00 where wallet_id = ?", [wallet.id]).catch(() => undefined);

        const [entry] = await sql("select amount from wallet_ledger_entries where wallet_id = ?", [wallet.id]);
        expect(Number(entry?.amount || 0)).toBe(100);
    });
});
