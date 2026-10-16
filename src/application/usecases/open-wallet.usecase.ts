import { Injectable } from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";

import { hashPayload } from "../../domain/shared/canonical-json";
import { Money } from "../../domain/shared/money";
import { WagerTransaction } from "../../domain/wager/wager-transaction";
import { WagerTransactionKind } from "../../domain/wager/wager-transaction.types";
import { Wallet } from "../../domain/wallet/wallet";

import type { OpenWalletCommand, OpenWalletResult } from "../dto/wallet.dto";

import { UniqueViolationError, WalletAlreadyExistsError } from "../errors";

import { AppLogger } from "../ports/observability.port";
import { UniqueConstraints } from "../ports/repositories.port";
import { UnitOfWork } from "../ports/unit-of-work.port";

import { assertObject, assertText } from "../validation/input-validation";

/** Provedor reservado para transações internas (OPENING). Não pode ser submetido pela API nem pela fila. */
const INTERNAL_PROVIDER = "INTERNAL";

@Injectable()
export class OpenWalletUseCase
{
    constructor(
        private readonly uow: UnitOfWork,
        private readonly logger: AppLogger,
    ) {}

    public async execute(command: OpenWalletCommand): Promise<OpenWalletResult>
    {
        const body = assertObject(command, "body");
        const playerId = assertText(body.playerId, "playerId");
        const balance = assertObject(body.initialBalance, "initialBalance");
        const initialBalance = Money.from({ amount: balance.amount as string, currency: balance.currency as string });

        try
        {
            const result = await this.uow.run(async (scope) =>
            {
                if (await scope.wallets.existsForPlayer(playerId, initialBalance.currency)) throw new WalletAlreadyExistsError(playerId, initialBalance.currency);

                const wallet = Wallet.open({ id: uuidv7(), playerId, initialBalance });
                scope.wallets.add(wallet);

                if (initialBalance.isPositive())
                {
                    const opening = this.createOpeningTransaction(wallet, initialBalance);
                    scope.transactions.add(opening);
                    scope.ledger.add(wallet.openingEntry(uuidv7(), opening.id));
                }

                return wallet;
            });

            this.logger.info("Wallet criada", { walletId: result.id, currency: result.currency });

            return { id: result.id, playerId: result.playerId, balance: result.balance.toJSON(), version: result.version };
        }
        catch (err)
        {
            if (err instanceof UniqueViolationError && err.constraint === UniqueConstraints.WalletPlayerCurrency)
                throw new WalletAlreadyExistsError(playerId, initialBalance.currency);

            throw err;
        }
    }

    private createOpeningTransaction(wallet: Wallet, initialBalance: Money): WagerTransaction
    {
        const transaction = WagerTransaction.create({
            id: uuidv7(),
            providerId: INTERNAL_PROVIDER,
            externalTransactionId: `OPENING-${wallet.id}`,
            idempotencyKey: `internal:opening:${wallet.id}`,
            payloadHash: hashPayload({ walletId: wallet.id, playerId: wallet.playerId, initialBalance: initialBalance.toJSON() }),
            walletId: wallet.id,
            playerId: wallet.playerId,
            roundId: "OPENING",
            gameId: "SYSTEM",
            kind: WagerTransactionKind.Opening,
            money: initialBalance,
        });

        transaction.markProcessed(undefined, new Date());
        transaction.recordBalanceAfter(wallet.balance);

        return transaction;
    }
}