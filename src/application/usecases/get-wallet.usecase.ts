import { Injectable } from "@nestjs/common";

import type { WalletResponse } from "../dto/wallet.dto";

import { WalletNotFoundError } from "../errors";

import { WalletQueries } from "../ports/queries.port";

import { assertUuid } from "../validation/input-validation";

@Injectable()
export class GetWalletUseCase
{
    constructor(private readonly queries: WalletQueries) {}

    public async execute(walletId: string): Promise<WalletResponse>
    {
        assertUuid(walletId, "walletId");

        const wallet = await this.queries.findWallet(walletId);
        if (!wallet) throw new WalletNotFoundError(walletId);

        return {
            id: wallet.id,
            playerId: wallet.playerId,
            balance: wallet.balance,
            version: wallet.version,
            createdAt: wallet.createdAt.toISOString(),
            updatedAt: wallet.updatedAt.toISOString(),
        };
    }
}