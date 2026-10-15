import { Injectable } from "@nestjs/common";
import { InvalidInputError, WalletNotFoundError } from "../../domain/common/errors";
import { assertUuid, isUuid } from "../validation/wager-input.validation";
import { EntityManager } from "@mikro-orm/postgresql";
import { WalletEntity } from "../../infra/database/entities/wallet.entity";

export interface LedgerItemDto
{
    id: string;
    transactionId: string;
    direction: string;
    amount: string;
    currency: string;
    balanceBefore: string;
    balanceAfter: string;
    createdAt: string;
}

export interface GetLedgerOutput
{
    items: LedgerItemDto[];
    nextCursor?: string;
    hasMore: boolean;
}

@Injectable()
export class GetWalletLedgerUseCase
{
    constructor(private readonly em: EntityManager) {}

    public async execute(walletId: string, cursor?: string, limit: number = 50): Promise<GetLedgerOutput>
    {
        assertUuid(walletId, "walletId");
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new InvalidInputError("Parâmetro 'limit' deve ser um inteiro entre 1 e 100");

        const forkEm = this.em.fork();

        const wallet = await forkEm.findOne(WalletEntity, { id: walletId });
        if (!wallet) throw new WalletNotFoundError(walletId);

        const params: unknown[] = [walletId];

        let cursorCondition = "";

        if (cursor)
        {
            const [cursorDate, cursorId] = Buffer.from(cursor, "base64").toString("utf8").split("#");
            const date = new Date(cursorDate ?? "");

            if (Number.isNaN(date.getTime()) || !cursorId || !isUuid(cursorId)) throw new InvalidInputError("Parâmetro 'cursor' inválido");

            params.push(date, cursorId);
            cursorCondition = `AND (created_at, id) < (?, ?)`;
        }

        const rows = await forkEm.execute(`
                SELECT id, transaction_id, direction, amount, currency, balance_before, balance_after, created_at
                FROM wallet_ledger_entries WHERE wallet_id = ? ${cursorCondition} ORDER BY created_at DESC, id DESC LIMIT ?
            `, [...params, limit + 1],
        );

        const hasMore = rows.length > limit;
        const itemsToReturn = hasMore ? rows.slice(0, limit) : rows;

        let nextCursor: string | undefined;
        if (hasMore && itemsToReturn.length > 0)
        {
            const lastItem = itemsToReturn[itemsToReturn.length - 1];
            if (lastItem)
            {
                const cursorPayload = `${new Date(lastItem.created_at).toISOString()}#${lastItem.id}`;
                nextCursor = Buffer.from(cursorPayload).toString("base64");
            }
        }

        return {
            items: itemsToReturn.map((r) => ({
                id: r.id,
                transactionId: r.transaction_id,
                direction: r.direction,
                amount: r.amount,
                currency: r.currency,
                balanceBefore: r.balance_before,
                balanceAfter: r.balance_after,
                createdAt: new Date(r.created_at).toISOString(),
            })),
            nextCursor,
            hasMore,
        };
    }
}