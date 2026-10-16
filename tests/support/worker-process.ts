import { createTestContext } from "./test-context";

import { WagerTransactionKind } from "../../src/domain/wager/wager-transaction.types";

const [walletId, playerId, processIndex] = process.argv.slice(2);
if (!walletId || !playerId || !processIndex) throw new Error("Parâmetros obrigatórios para o teste não presentes");

const ctx = await createTestContext();

try
{
    await ctx.processWager.execute({
        providerId: "provider-multiprocess",
        externalTransactionId: `mp-bet-proc-${processIndex}-${Date.now()}`,
        idempotencyKey: `mp-idemp-proc-${processIndex}-${Date.now()}`,
        playerId,
        walletId,
        roundId: "round-multiprocess",
        gameId: "game-multiprocess",
        kind: WagerTransactionKind.Bet,
        money: { amount: "40.00", currency: "BRL" },
    });
}
finally
{
    await ctx.close();
}