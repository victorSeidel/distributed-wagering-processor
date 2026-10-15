import { Injectable, ConflictException } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { v7 as uuidv7 } from "uuid";
import { Money } from "../../domain/common/money";
import { Wallet } from "../../domain/wallet/wallet";
import { WagerTransaction } from "../../domain/wager/wager-transaction";
import { WalletLedgerEntry } from "../../domain/wallet/wallet-ledger-entry";
import { hashPayload } from "../../domain/common/canonical-json";
import type { Money as MoneyType } from "../../model/type/money.type";
import { WalletEntity } from "../../infra/database/entities/wallet.entity";
import { DatabaseMapper } from "../../infra/database/database.mapper";
import { WagerTransactionKind } from "../../model/entity/wager.entity";
import { LedgerDirection } from "../../model/type/wallet.type";

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
        const money = Money.from(input.initialBalance);

        return await this.em.transactional(async (em) =>
        {
            const existing = await em.findOne(WalletEntity, {
                playerId: input.playerId,
                currency: money.currency,
            });

            if (existing) throw new ConflictException(`Wallet já existente para o jogador ${input.playerId} com moeda ${money.currency}`);

            const walletId = uuidv7();
            const wallet = Wallet.open({
                id: walletId,
                playerId: input.playerId,
                initialBalance: money,
            });

            const walletEntity = DatabaseMapper.toWalletEntity(wallet);
            em.persist(walletEntity);

            if (money.isPositive())
            {
                const transactionId = uuidv7();
                const payloadHash = hashPayload({
                    walletId,
                    playerId: input.playerId,
                    initialBalance: input.initialBalance,
                });

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

            return {
                id: wallet.id,
                playerId: wallet.playerId,
                balance: wallet.balance.toJSON(),
                version: wallet.version,
            };
        });
    }
}