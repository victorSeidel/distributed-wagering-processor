import { describe, expect, it, beforeAll, afterAll } from "bun:test";

import { MikroORM } from "@mikro-orm/postgresql";
import mikroOrmConfig from "../../mikro-orm.config";

import { v7 as uuidv7 } from "uuid";

import { WagerFailureCode, WagerTransactionKind, WagerTransactionStatus } from "../../src/model/entity/wager.entity";

import { OpenWalletUseCase } from "../../src/application/usecase/open-wallet.usecase";
import { ProcessWagerUseCase } from "../../src/application/usecase/process-wager.usecase";
import { ReconcileWalletUseCase } from "../../src/application/usecase/reconcile-wallet.usecase";

describe("Testes Obrigatórios de Concorrência e Integridade Contábil", () =>
{
    let orm: MikroORM;
    let openWalletUseCase: OpenWalletUseCase;
    let processWagerUseCase: ProcessWagerUseCase;
    let reconcileWalletUseCase: ReconcileWalletUseCase;

    beforeAll(async () =>
    {
        orm = await MikroORM.init(mikroOrmConfig);
        openWalletUseCase = new OpenWalletUseCase(orm.em);
        processWagerUseCase = new ProcessWagerUseCase(orm.em);
        reconcileWalletUseCase = new ReconcileWalletUseCase(orm.em);
    });

    afterAll(async () =>
    {
        await orm.close(true);
    });

    it("Cenário Obrigatório Seção 8: 100.00 BRL com duas apostas simultâneas de 80.00 BRL", async () =>
    {
        const playerId = uuidv7();
        const wallet = await openWalletUseCase.execute({ playerId, initialBalance: { amount: "100.00", currency: "BRL" } });

        const promiseA = processWagerUseCase.execute({
            providerId: "provider-concurrency",
            externalTransactionId: `bet-a-${uuidv7()}`,
            idempotencyKey: `idemp-a-${uuidv7()}`,
            playerId,
            walletId: wallet.id,
            roundId: "round-1",
            gameId: "game-1",
            kind: WagerTransactionKind.Bet,
            money: { amount: "80.00", currency: "BRL" },
        });

        const promiseB = processWagerUseCase.execute({
            providerId: "provider-concurrency",
            externalTransactionId: `bet-b-${uuidv7()}`,
            idempotencyKey: `idemp-b-${uuidv7()}`,
            playerId,
            walletId: wallet.id,
            roundId: "round-1",
            gameId: "game-1",
            kind: WagerTransactionKind.Bet,
            money: { amount: "80.00", currency: "BRL" },
        });

        const [resA, resB] = await Promise.all([promiseA, promiseB]);

        const statuses = [resA.status, resB.status].sort();
        expect(statuses).toEqual([WagerTransactionStatus.Processed, WagerTransactionStatus.Rejected]);

        const rejected = resA.status === WagerTransactionStatus.Rejected ? resA : resB;
        expect(rejected.failureCode).toBe(WagerFailureCode.InsufficientFunds);

        const reconciliation = await reconcileWalletUseCase.execute(wallet.id);
        expect(reconciliation.storedBalance.amount).toBe("20.00");
        expect(reconciliation.calculatedBalance.amount).toBe("20.00");
        expect(reconciliation.difference.amount).toBe("0.00");
        expect(reconciliation.consistent).toBe(true);

        expect(reconciliation.checkedEntries).toBe(2);
    });

    it("Cenário Obrigatório Seção 13: A mesma aposta enviada 50 vezes em paralelo resulta em apenas 1 débito", async () =>
    {
        const playerId = uuidv7();
        const wallet = await openWalletUseCase.execute({ playerId, initialBalance: { amount: "500.00", currency: "BRL" } });

        const fixedExternalId = `tx-50-parallel-${uuidv7()}`;
        const fixedIdempotencyKey = `idemp-50-${fixedExternalId}`;

        const requests = Array.from({ length: 50 }, () =>
            processWagerUseCase.execute({
                providerId: "provider-idempotency",
                externalTransactionId: fixedExternalId,
                idempotencyKey: fixedIdempotencyKey,
                playerId,
                walletId: wallet.id,
                roundId: "round-50",
                gameId: "game-50",
                kind: WagerTransactionKind.Bet,
                money: { amount: "10.00", currency: "BRL" },
            })
        );

        const responses = await Promise.all(requests);

        for (const res of responses)
        {
            expect(res.status).toBe(WagerTransactionStatus.Processed);
            expect(res.balance.amount).toBe("490.00");
        }

        const originalCount = responses.filter((r) => r.idempotentReplay === false).length;
        const replayCount = responses.filter((r) => r.idempotentReplay === true).length;

        expect(originalCount).toBe(1);
        expect(replayCount).toBe(49);

        const reconciliation = await reconcileWalletUseCase.execute(wallet.id);
        expect(reconciliation.storedBalance.amount).toBe("490.00");
        expect(reconciliation.calculatedBalance.amount).toBe("490.00");
        expect(reconciliation.consistent).toBe(true);
        expect(reconciliation.checkedEntries).toBe(2);
    });
});