import { describe, expect, it } from "bun:test";

import { v7 as uuidv7 } from "uuid";

import { hashPayload } from "../../src/domain/shared/canonical-json";
import { CurrencyMismatchError, InvalidInputError, InvalidTransactionStateError } from "../../src/domain/shared/errors";
import { Money } from "../../src/domain/shared/money";
import { WagerSettlement, type SettlementInput } from "../../src/domain/wager/wager-settlement";
import { WagerTransaction } from "../../src/domain/wager/wager-transaction";
import { WagerFailureCode, WagerTransactionKind, WagerTransactionStatus } from "../../src/domain/wager/wager-transaction.types";
import { LedgerDirection } from "../../src/domain/wallet/ledger-direction";
import { Wallet } from "../../src/domain/wallet/wallet";

const BRL = (amount: string) => Money.from({ amount, currency: "BRL" });

interface Fixture
{
    wallet: Wallet;
    playerId: string;
    roundId: string;
}

function fixture(balance: string): Fixture
{
    const playerId = uuidv7();
    const wallet = Wallet.open({ id: uuidv7(), playerId, initialBalance: BRL(balance) });
    return { wallet, playerId, roundId: "round-1" };
}

function tx(f: Fixture, kind: WagerTransactionKind, amount: string, extra: { ext?: string; ref?: string; playerId?: string; roundId?: string } = {}): WagerTransaction
{
    return WagerTransaction.create({
        id: uuidv7(),
        providerId: "provider-unit",
        externalTransactionId: extra.ext ?? `ext-${uuidv7()}`,
        idempotencyKey: `k-${uuidv7()}`,
        payloadHash: `h-${uuidv7()}`,
        walletId: f.wallet.id,
        playerId: extra.playerId ?? f.playerId,
        roundId: extra.roundId ?? f.roundId,
        gameId: "game-unit",
        kind,
        money: BRL(amount),
        referenceExternalTransactionId: extra.ref,
    });
}

function processed(f: Fixture, kind: WagerTransactionKind, amount: string, ext: string, ref?: string): WagerTransaction
{
    const t = tx(f, kind, amount, { ext, ref });
    t.markProcessed(undefined, new Date());
    return t;
}

function apply(f: Fixture, transaction: WagerTransaction, reference?: WagerTransaction, alreadyReversed = false)
{
    const input: SettlementInput = {
        wallet: f.wallet,
        transaction,
        reference,
        referenceAlreadyReversed: alreadyReversed,
        ledgerEntryId: uuidv7(),
        at: new Date(),
    };
    return WagerSettlement.apply(input);
}

describe("Regras de liquidação: BET", () =>
{
    it("Débito dentro do saldo: PROCESSED, saldo reduzido, 1 lançamento DEBIT", () =>
    {
        const f = fixture("100.00");
        const bet = tx(f, WagerTransactionKind.Bet, "80.00");

        const result = apply(f, bet);

        expect(result.type).toBe("PROCESSED");
        expect(bet.status).toBe(WagerTransactionStatus.Processed);
        expect(f.wallet.balance.toString()).toBe("20.00");
        expect(f.wallet.version).toBe(2);
        expect(result.type === "PROCESSED" && result.ledgerEntry?.direction).toBe(LedgerDirection.Debit);
        expect(bet.balanceAfter?.toString()).toBe("20.00");
    });

    it("Saldo insuficiente: REJECTED INSUFFICIENT_FUNDS, sem lançamento e sem alterar saldo ou versão", () =>
    {
        const f = fixture("100.00");
        const bet = tx(f, WagerTransactionKind.Bet, "100.01");

        const result = apply(f, bet);

        expect(result).toEqual({ type: "REJECTED", failureCode: WagerFailureCode.InsufficientFunds });
        expect(bet.status).toBe(WagerTransactionStatus.Rejected);
        expect(f.wallet.balance.toString()).toBe("100.00");
        expect(f.wallet.version).toBe(1);
    });

    it("Aposta de saldo exato zera a carteira sem ficar negativa", () =>
    {
        const f = fixture("50.00");
        apply(f, tx(f, WagerTransactionKind.Bet, "50.00"));
        expect(f.wallet.balance.toString()).toBe("0.00");
    });

    it("Jogador divergente da wallet: REJECTED PLAYER_MISMATCH", () =>
    {
        const f = fixture("100.00");
        const bet = tx(f, WagerTransactionKind.Bet, "10.00", { playerId: uuidv7() });

        expect(apply(f, bet)).toEqual({ type: "REJECTED", failureCode: WagerFailureCode.PlayerMismatch });
        expect(f.wallet.balance.toString()).toBe("100.00");
    });
});

describe("Regras de liquidação: WIN e LOSS", () =>
{
    it("WIN credita saldo e gera 1 lançamento CREDIT", () =>
    {
        const f = fixture("10.00");
        const result = apply(f, tx(f, WagerTransactionKind.Win, "30.00"));

        expect(result.type === "PROCESSED" && result.ledgerEntry?.direction).toBe(LedgerDirection.Credit);
        expect(f.wallet.balance.toString()).toBe("40.00");
    });

    it("LOSS é PROCESSED, não move saldo, não incrementa versão e não gera lançamento", () =>
    {
        const f = fixture("10.00");
        const loss = tx(f, WagerTransactionKind.Loss, "5.00");

        const result = apply(f, loss);

        expect(result).toEqual({ type: "PROCESSED", ledgerEntry: undefined });
        expect(loss.status).toBe(WagerTransactionStatus.Processed);
        expect(f.wallet.balance.toString()).toBe("10.00");
        expect(f.wallet.version).toBe(1);
    });
});

describe("Regras de liquidação: REFUND", () =>
{
    it("REFUND de BET PROCESSED credita o valor integral", () =>
    {
        const f = fixture("20.00");
        const bet = processed(f, WagerTransactionKind.Bet, "30.00", "bet-1");

        const refund = tx(f, WagerTransactionKind.Refund, "30.00", { ref: "bet-1" });
        const result = apply(f, refund, bet);

        expect(result.type).toBe("PROCESSED");
        expect(f.wallet.balance.toString()).toBe("50.00");
        expect(refund.referenceTransactionId).toBe(bet.id);
    });

    it("REFUND cuja referência ainda não existe aguarda (AWAITING_REFERENCE) sem efeito", () =>
    {
        const f = fixture("20.00");
        const refund = tx(f, WagerTransactionKind.Refund, "30.00", { ref: "missing" });

        expect(apply(f, refund, undefined)).toEqual({ type: "AWAITING_REFERENCE" });
        expect(refund.status).toBe(WagerTransactionStatus.Pending);
        expect(f.wallet.balance.toString()).toBe("20.00");
    });

    it("REFUND de referência ainda pendente aguarda", () =>
    {
        const f = fixture("20.00");
        const pendingBet = tx(f, WagerTransactionKind.Bet, "30.00", { ext: "bet-p" });
        pendingBet.markPendingReference();

        const refund = tx(f, WagerTransactionKind.Refund, "30.00", { ref: "bet-p" });
        expect(apply(f, refund, pendingBet)).toEqual({ type: "AWAITING_REFERENCE" });
    });

    it("REFUND de referência REJECTED: REFERENCE_NOT_PROCESSED (sem crédito fantasma)", () =>
    {
        const f = fixture("20.00");
        const rejected = tx(f, WagerTransactionKind.Bet, "30.00", { ext: "bet-r" });
        rejected.reject(WagerFailureCode.InsufficientFunds);

        const refund = tx(f, WagerTransactionKind.Refund, "30.00", { ref: "bet-r" });
        expect(apply(f, refund, rejected)).toEqual({ type: "REJECTED", failureCode: WagerFailureCode.ReferenceNotProcessed });
        expect(f.wallet.balance.toString()).toBe("20.00");
    });

    it("REFUND de WIN: INVALID_REFERENCE_TYPE (REFUND só referencia BET)", () =>
    {
        const f = fixture("20.00");
        const win = processed(f, WagerTransactionKind.Win, "30.00", "win-1");

        const refund = tx(f, WagerTransactionKind.Refund, "30.00", { ref: "win-1" });
        expect(apply(f, refund, win)).toEqual({ type: "REJECTED", failureCode: WagerFailureCode.InvalidReferenceType });
    });

    it("REFUND com valor diferente da referência: AMOUNT_MISMATCH", () =>
    {
        const f = fixture("20.00");
        const bet = processed(f, WagerTransactionKind.Bet, "30.00", "bet-2");

        const refund = tx(f, WagerTransactionKind.Refund, "29.99", { ref: "bet-2" });
        expect(apply(f, refund, bet)).toEqual({ type: "REJECTED", failureCode: WagerFailureCode.AmountMismatch });
    });

    it("REFUND com rodada divergente da referência: REFERENCE_MISMATCH", () =>
    {
        const f = fixture("20.00");
        const bet = processed(f, WagerTransactionKind.Bet, "30.00", "bet-3");

        const refund = tx(f, WagerTransactionKind.Refund, "30.00", { ref: "bet-3", roundId: "outra-rodada" });
        expect(apply(f, refund, bet)).toEqual({ type: "REJECTED", failureCode: WagerFailureCode.ReferenceMismatch });
    });

    it("REFUND já aplicado para a mesma referência: REFERENCE_ALREADY_REVERSED", () =>
    {
        const f = fixture("20.00");
        const bet = processed(f, WagerTransactionKind.Bet, "30.00", "bet-4");

        const refund = tx(f, WagerTransactionKind.Refund, "30.00", { ref: "bet-4" });
        expect(apply(f, refund, bet, true)).toEqual({ type: "REJECTED", failureCode: WagerFailureCode.ReferenceAlreadyReversed });
        expect(f.wallet.balance.toString()).toBe("20.00");
    });

    it("REFUND sem referenceExternalTransactionId é erro de entrada", () =>
    {
        const f = fixture("20.00");
        expect(() => tx(f, WagerTransactionKind.Refund, "10.00")).toThrow(InvalidInputError);
    });
});

describe("Regras de liquidação: ROLLBACK", () =>
{
    it("ROLLBACK de BET devolve o valor (inverso do débito)", () =>
    {
        const f = fixture("70.00");
        const bet = processed(f, WagerTransactionKind.Bet, "30.00", "bet-rb");

        const result = apply(f, tx(f, WagerTransactionKind.Rollback, "30.00", { ref: "bet-rb" }), bet);

        expect(result.type === "PROCESSED" && result.ledgerEntry?.direction).toBe(LedgerDirection.Credit);
        expect(f.wallet.balance.toString()).toBe("100.00");
    });

    it("ROLLBACK de WIN retira o valor (inverso do crédito)", () =>
    {
        const f = fixture("130.00");
        const win = processed(f, WagerTransactionKind.Win, "30.00", "win-rb");

        const result = apply(f, tx(f, WagerTransactionKind.Rollback, "30.00", { ref: "win-rb" }), win);

        expect(result.type === "PROCESSED" && result.ledgerEntry?.direction).toBe(LedgerDirection.Debit);
        expect(f.wallet.balance.toString()).toBe("100.00");
    });

    it("ROLLBACK de REFUND retira o valor creditado", () =>
    {
        const f = fixture("50.00");
        const refund = processed(f, WagerTransactionKind.Refund, "30.00", "rf-rb", "bet-origem");

        apply(f, tx(f, WagerTransactionKind.Rollback, "30.00", { ref: "rf-rb" }), refund);

        expect(f.wallet.balance.toString()).toBe("20.00");
    });

    it("ROLLBACK que deixaria saldo negativo: REVERSAL_WOULD_PRODUCE_NEGATIVE_BALANCE (distinto de INSUFFICIENT_FUNDS)", () =>
    {
        const f = fixture("10.00");
        const win = processed(f, WagerTransactionKind.Win, "30.00", "win-neg");

        const rollback = tx(f, WagerTransactionKind.Rollback, "30.00", { ref: "win-neg" });
        expect(apply(f, rollback, win)).toEqual({ type: "REJECTED", failureCode: WagerFailureCode.ReversalWouldProduceNegativeBalance });
        expect(f.wallet.balance.toString()).toBe("10.00");
    });

    it("ROLLBACK de LOSS ou de outro ROLLBACK: INVALID_REFERENCE_TYPE", () =>
    {
        const f = fixture("10.00");
        const loss = processed(f, WagerTransactionKind.Loss, "5.00", "loss-rb");
        expect(apply(f, tx(f, WagerTransactionKind.Rollback, "5.00", { ref: "loss-rb" }), loss))
            .toEqual({ type: "REJECTED", failureCode: WagerFailureCode.InvalidReferenceType });

        const rb = processed(f, WagerTransactionKind.Rollback, "5.00", "rb-rb", "loss-rb");
        expect(apply(f, tx(f, WagerTransactionKind.Rollback, "5.00", { ref: "rb-rb" }), rb))
            .toEqual({ type: "REJECTED", failureCode: WagerFailureCode.InvalidReferenceType });
    });

    it("ROLLBACK de referência já revertida: REFERENCE_ALREADY_REVERSED", () =>
    {
        const f = fixture("70.00");
        const bet = processed(f, WagerTransactionKind.Bet, "30.00", "bet-rb2");

        expect(apply(f, tx(f, WagerTransactionKind.Rollback, "30.00", { ref: "bet-rb2" }), bet, true))
            .toEqual({ type: "REJECTED", failureCode: WagerFailureCode.ReferenceAlreadyReversed });
    });
});

describe("Invariantes de transação e moeda", () =>
{
    it("Transação terminal não pode mudar de estado", () =>
    {
        const f = fixture("100.00");
        const bet = tx(f, WagerTransactionKind.Bet, "10.00");
        apply(f, bet);

        expect(() => bet.reject(WagerFailureCode.InsufficientFunds)).toThrow(InvalidTransactionStateError);
    });

    it("Moeda da transação diferente da wallet: CurrencyMismatchError", () =>
    {
        const f = fixture("100.00");
        const usd = WagerTransaction.create({
            id: uuidv7(),
            providerId: "p",
            externalTransactionId: "usd-1",
            idempotencyKey: "usd-1",
            payloadHash: "h",
            walletId: f.wallet.id,
            playerId: f.playerId,
            roundId: f.roundId,
            gameId: "g",
            kind: WagerTransactionKind.Bet,
            money: Money.from({ amount: "10.00", currency: "USD" }),
        });

        expect(() => apply(f, usd)).toThrow(CurrencyMismatchError);
    });

    it("Hash do payload é independente da ordem das chaves e sensível a qualquer alteração de valor", () =>
    {
        const a = hashPayload({ kind: "BET", money: { amount: "10.00", currency: "BRL" }, roundId: "r" });
        const b = hashPayload({ roundId: "r", money: { currency: "BRL", amount: "10.00" }, kind: "BET" });
        const c = hashPayload({ kind: "BET", money: { amount: "10.01", currency: "BRL" }, roundId: "r" });

        expect(a).toBe(b);
        expect(a).not.toBe(c);
    });
});