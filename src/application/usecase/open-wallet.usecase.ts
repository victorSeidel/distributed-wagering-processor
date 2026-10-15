import { Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { UniqueConstraintViolationException } from "@mikro-orm/core";
import { v7 as uuidv7 } from "uuid";

import { Money } from "../../domain/common/money";
import { Wallet } from "../../domain/wallet/wallet";
import { WagerTransaction } from "../../domain/wager/wager-transaction";
import { WalletLedgerEntry } from "../../domain/wallet/wallet-ledger-entry";
import { hashPayload } from "../../domain/common/canonical-json";
import { WalletAlreadyExistsError } from "../../domain/common/errors";
import { assertObject, assertText } from "../validation/wager-input.validation";

import type { Money as MoneyType } from "../../model/type/money.type";
import { WagerTransactionKind } from "../../model/entity/wager.entity";
import { LedgerDirection } from "../../model/type/wallet.type";

import { WalletEntity } from "../../infra/database/entities/wallet.entity";
import { DatabaseMapper } from "../../infra/database/database.mapper";

export interface OpenWalletInput
{
    playerId: string;
    initialBalance: MoneyType;
}

export interface OpenWalletOutput
{
    id: string;
    playerId: string;
    balance: MoneyType;
    version: number;
}

@Injectable()
export class OpenWalletUseCase
{
    constructor(private readonly em: EntityManager) {}

    public async execute(input: OpenWalletInput): Promise<OpenWalletOutput>
    {
        const body = assertObject(input, "body");
        const playerId = assertText(body.playerId, "playerId");
        const balanceBody = assertObject(body.initialBalance, "initialBalance");
        const money = Money.from({ amount: balanceBody.amount as string, currency: balanceBody.currency as string });

        try
        {
            return await this.openWallet(playerId, money);
        }
        catch (err)
        {
            if (err instanceof UniqueConstraintViolationException) throw new WalletAlreadyExistsError(playerId, money.currency);
            throw err;
        }
    }

    private async openWallet(playerId: string, money: Money): Promise<OpenWalletOutput>
    {
        const input = { playerId, initialBalance: money.toJSON() };

        return await this.em.transactional(async (em) =>
        {
            const existing = await em.findOne(WalletEntity, { playerId: input.playerId, currency: money.currency });
            if (existing) throw new WalletAlreadyExistsError(input.playerId, money.currency);

            const walletId = uuidv7();
            const wallet = Wallet.open({ id: walletId, playerId: input.playerId, initialBalance: money });
            const walletEntity = DatabaseMapper.toWalletEntity(wallet);
            em.persist(walletEntity);

            if (money.isPositive())
            {
                const transactionId = uuidv7();
                const payloadHash = hashPayload({ walletId, playerId: input.playerId, initialBalance: input.initialBalance });

                const openingTx = WagerTransaction.create({
                    id: transactionId,
                    providerId: "INTERNAL",
                    externalTransactionId: `OPENING-${walletId}`,
                    idempotencyKey: `internal:opening:${walletId}`,
                    payloadHash,
                    walletId,
                    playerId: input.playerId,
                    roundId: "OPENING",
                    gameId: "SYSTEM",
                    kind: WagerTransactionKind.Opening,
                    money,
                });

                openingTx.markProcessed(undefined, new Date());
                em.persist(DatabaseMapper.toWagerEntity(openingTx));

                const ledgerEntry = WalletLedgerEntry.create({
                    id: uuidv7(),
                    walletId,
                    transactionId,
                    direction: LedgerDirection.Credit,
                    money,
                    balanceBefore: Money.zero(money.currency),
                    balanceAfter: money,
                });

                em.persist(DatabaseMapper.toLedgerEntity(ledgerEntry));
            }

            await em.flush();
            return { id: wallet.id, playerId: wallet.playerId, balance: wallet.balance.toJSON(), version: wallet.version };
        });
    }
}