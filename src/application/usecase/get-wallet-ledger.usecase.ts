import { Injectable, NotFoundException } from "@nestjs/common";
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
        const forkEm = this.em.fork();

        const wallet = await forkEm.findOne(WalletEntity, { id: walletId });
        if (!wallet) throw new NotFoundException(`Wallet '${walletId}' não encontrada.`);

        const params: unknown[] = [walletId, limit + 1];

        let cursorCondition = "";

        if (cursor)
        {
            try
            {
                const decoded = Buffer.from(cursor, "base64").toString("utf8");
                const [cursorDate, cursorId] = decoded.split("#");

                if (cursorDate && cursorId)
                {
                    params.push(new Date(cursorDate), cursorId);
                    cursorCondition = `AND (created_at, id) < ($3, $4)`;
                }
            }
            catch
            {
                // Ignora cursor malformado e busca do início
            }
        }

        const rows = await forkEm.getConnection().execute(`
                SELECT id, transaction_id, direction, amount, currency, balance_before, balance_after, created_at
                FROM wallet_ledger_entries WHERE wallet_id = $1 ${cursorCondition} ORDER BY created_at DESC, id DESC LIMIT $2
            `, params,
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