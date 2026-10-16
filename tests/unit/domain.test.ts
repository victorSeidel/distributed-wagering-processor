import { describe, expect, it } from "bun:test";

import { v7 as uuidv7 } from "uuid";

import { Money } from "../../src/domain/shared/money";
import { Wallet } from "../../src/domain/wallet/wallet";
import { WalletLedgerEntry } from "../../src/domain/wallet/wallet-ledger-entry";
import { WagerTransactionKind, WagerTransactionStatus, WagerFailureCode } from "../../src/domain/wager/wager-transaction.types";
import { LedgerDirection } from "../../src/domain/wallet/ledger-direction";
import { WagerTransaction } from "../../src/domain/wager/wager-transaction";

describe("Domain Unit Tests", () =>
{
describe("Wallet Invariants", () =>
    {
        it("Deve abrir carteira com versão inicial 1 e saldo correspondente", () =>
        {
            const wallet = Wallet.open({ id: uuidv7(), playerId: uuidv7(), initialBalance: Money.from({ amount: "100.00", currency: "BRL" }) });
            expect(wallet.version).toBe(1);
            expect(wallet.balance.toString()).toBe("100.00");
            expect(wallet.currency).toBe("BRL");
        });

        it("Deve debitar saldo e incrementar a versão", () =>
        {
            const wallet = Wallet.open({ id: uuidv7(), playerId: uuidv7(), initialBalance: Money.from({ amount: "100.00", currency: "BRL" }) });
            const entry = wallet.debit({ entryId: uuidv7(), transactionId: uuidv7(), amount: Money.from({ amount: "40.00", currency: "BRL" }) });
            expect(wallet.balance.toString()).toBe("60.00");
            expect(wallet.version).toBe(2);
            expect(entry).toBeDefined();
            expect(entry.isBalanced()).toBe(true);
        });

        it("Deve creditar saldo e incrementar a versão", () =>
        {
            const wallet = Wallet.open({ id: uuidv7(), playerId: uuidv7(), initialBalance: Money.from({ amount: "100.00", currency: "BRL" }) });
            const entry = wallet.credit({ entryId: uuidv7(), transactionId: uuidv7(), amount: Money.from({ amount: "50.00", currency: "BRL" }) });
            expect(wallet.balance.toString()).toBe("150.00");
            expect(wallet.version).toBe(2);
            expect(entry).toBeDefined();
            expect(entry.isBalanced()).toBe(true);
        });

        it("Deve impedir débito que resultaria em saldo negativo", () =>
        {
            const wallet = Wallet.open({ id: uuidv7(), playerId: uuidv7(), initialBalance: Money.from({ amount: "50.00", currency: "BRL" }) });
            expect(() => wallet.debit({ entryId: uuidv7(), transactionId: uuidv7(), amount: Money.from({ amount: "50.01", currency: "BRL" }) })).toThrow();
        });

        it("Deve rejeitar operações com moedas divergentes da carteira", () =>
        {
            const wallet = Wallet.open({ id: uuidv7(), playerId: uuidv7(), initialBalance: Money.from({ amount: "50.00", currency: "BRL" }) });
            expect(() => wallet.credit({ entryId: uuidv7(), transactionId: uuidv7(), amount: Money.from({ amount: "10.00", currency: "USD" }) })).toThrow();
            expect(() => wallet.debit({ entryId: uuidv7(), transactionId: uuidv7(), amount: Money.from({ amount: "10.00", currency: "EUR" }) })).toThrow();
        });
    });

    describe("WalletLedgerEntry Invariants", () =>
    {
        it("Deve criar entrada de ledger balanceada (Credit)", () =>
        {
            const entry = WalletLedgerEntry.create({
                id: uuidv7(),
                walletId: uuidv7(),
                transactionId: uuidv7(),
                direction: LedgerDirection.Credit,
                money: Money.from({ amount: "20.00", currency: "BRL" }),
                balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
                balanceAfter: Money.from({ amount: "120.00", currency: "BRL" }),
            });

            expect(entry.isBalanced()).toBe(true);
        });

        it("Deve criar entrada de ledger balanceada (Debit)", () =>
        {
            const entry = WalletLedgerEntry.create({
                id: uuidv7(),
                walletId: uuidv7(),
                transactionId: uuidv7(),
                direction: LedgerDirection.Debit,
                money: Money.from({ amount: "30.00", currency: "BRL" }),
                balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
                balanceAfter: Money.from({ amount: "70.00", currency: "BRL" }),
            });

            expect(entry.isBalanced()).toBe(true);
        });

        it("Deve lançar erro se a aritmética balanceBefore ± money != balanceAfter for inconsistente", () =>
        {
            expect(() =>
                WalletLedgerEntry.create({
                    id: uuidv7(),
                    walletId: uuidv7(),
                    transactionId: uuidv7(),
                    direction: LedgerDirection.Credit,
                    money: Money.from({ amount: "20.00", currency: "BRL" }),
                    balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
                    balanceAfter: Money.from({ amount: "150.00", currency: "BRL" }),
                })
            ).toThrow();
        });
    });

    describe("WagerTransaction State Machine", () =>
    {
        it("REFUND e ROLLBACK devem exigir referenceExternalTransactionId na criação", () =>
        {
            expect(() =>
                WagerTransaction.create({
                    id: uuidv7(),
                    providerId: "p1",
                    externalTransactionId: "ext-1",
                    idempotencyKey: "k-1",
                    payloadHash: "hash-1",
                    walletId: uuidv7(),
                    playerId: uuidv7(),
                    roundId: "r-1",
                    gameId: "g-1",
                    kind: WagerTransactionKind.Refund,
                    money: Money.from({ amount: "10.00", currency: "BRL" }),
                    referenceExternalTransactionId: undefined,
                })
            ).toThrow();
        });

        it("Deve transicionar status corretamente e proibir alteração após estado terminal", () =>
        {
            const tx = WagerTransaction.create({
                id: uuidv7(),
                providerId: "p1",
                externalTransactionId: "ext-1",
                idempotencyKey: "k-1",
                payloadHash: "hash-1",
                walletId: uuidv7(),
                playerId: uuidv7(),
                roundId: "r-1",
                gameId: "g-1",
                kind: WagerTransactionKind.Bet,
                money: Money.from({ amount: "10.00", currency: "BRL" }),
            });

            expect(tx.status).toBe(WagerTransactionStatus.Pending);
            expect(tx.isTerminal()).toBe(false);

            tx.markProcessed(undefined, new Date());
            expect(tx.status).toBe(WagerTransactionStatus.Processed);
            expect(tx.isTerminal()).toBe(true);

            expect(() => tx.reject(WagerFailureCode.InsufficientFunds)).toThrow("Transição ilegal");
        });
    });
});