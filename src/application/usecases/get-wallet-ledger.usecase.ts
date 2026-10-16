import { Injectable } from "@nestjs/common";

import { InvalidInputError } from "../../domain/shared/errors";

import type { LedgerPageResponse } from "../dto/wallet.dto";

import { WalletNotFoundError } from "../errors";

import { WalletQueries, type LedgerPosition } from "../ports/queries.port";

import { assertUuid, isUuid } from "../validation/input-validation";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

@Injectable()
export class GetWalletLedgerUseCase
{
    constructor(private readonly queries: WalletQueries) {}

    public async execute(walletId: string, cursor?: string, limit: number = DEFAULT_LIMIT): Promise<LedgerPageResponse>
    {
        assertUuid(walletId, "walletId");
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new InvalidInputError(`Parâmetro 'limit' deve ser um inteiro entre 1 e ${MAX_LIMIT}`);

        const after = cursor ? this.decodeCursor(cursor) : undefined;

        if (!(await this.queries.findWallet(walletId))) throw new WalletNotFoundError(walletId);

        const rows = await this.queries.listLedger(walletId, limit + 1, after);

        const hasMore = rows.length > limit;
        const items = hasMore ? rows.slice(0, limit) : rows;
        const last = items[items.length - 1];

        return {
            items: items.map((entry) => ({
                id: entry.id,
                transactionId: entry.transactionId,
                direction: entry.direction,
                money: entry.money,
                balanceBefore: entry.balanceBefore,
                balanceAfter: entry.balanceAfter,
                createdAt: entry.createdAt.toISOString(),
            })),
            nextCursor: hasMore && last ? this.encodeCursor({ createdAt: last.createdAt, id: last.id }) : undefined,
            hasMore,
        };
    }

    private encodeCursor(position: LedgerPosition): string
    {
        return Buffer.from(`${position.createdAt.toISOString()}#${position.id}`).toString("base64url");
    }

    private decodeCursor(cursor: string): LedgerPosition
    {
        const [rawDate, id] = Buffer.from(cursor, "base64url").toString("utf8").split("#");
        const createdAt = new Date(rawDate ?? "");

        if (Number.isNaN(createdAt.getTime()) || !isUuid(id)) throw new InvalidInputError("Parâmetro 'cursor' inválido");

        return { createdAt, id };
    }
}