import { Controller, Post, Get, Param, Body, Query, UseGuards, NotFoundException } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { ProviderIdentityGuard } from "../guard/provider-identity.guard";

import type { CreateWalletDto } from "../../model/dto/wallet.dto";
import { WalletEntity } from "../../infra/database/entities/wallet.entity";

import { OpenWalletUseCase } from "../usecase/open-wallet.usecase";
import { ReconcileWalletUseCase } from "../usecase/reconcile-wallet.usecase";
import { GetWalletLedgerUseCase } from "../usecase/get-wallet-ledger.usecase";

@Controller("wallets")
@UseGuards(ProviderIdentityGuard)
export class WalletsController
{
    constructor(
        private readonly openWalletUseCase: OpenWalletUseCase,
        private readonly reconcileWalletUseCase: ReconcileWalletUseCase,
        private readonly getWalletLedgerUseCase: GetWalletLedgerUseCase,
        private readonly em: EntityManager,
    ) {}

    @Post()
    async createWallet(@Body() dto: CreateWalletDto)
    {
        return await this.openWalletUseCase.execute(dto);
    }

    @Get(":walletId")
    async getWallet(@Param("walletId") walletId: string)
    {
        const forkEm = this.em.fork();
        const wallet = await forkEm.findOne(WalletEntity, { id: walletId });
        if (!wallet) throw new NotFoundException(`Wallet '${walletId}' não encontrada`);

        return {
            id: wallet.id,
            playerId: wallet.playerId,
            balance: {
                amount: wallet.balance,
                currency: wallet.currency,
            },
            version: wallet.version,
            createdAt: wallet.createdAt.toISOString(),
            updatedAt: wallet.updatedAt.toISOString(),
        };
    }

    @Get(":walletId/ledger")
    async getLedger( @Param("walletId") walletId: string, @Query("cursor") cursor?: string, @Query("limit") limit?: string)
    {
        const parsedLimit = limit ? Math.min(Math.max(Number(limit), 1), 100) : 50;
        return await this.getWalletLedgerUseCase.execute(walletId, cursor, parsedLimit);
    }

    @Post(":walletId/reconciliation")
    async reconcile(@Param("walletId") walletId: string)
    {
        return await this.reconcileWalletUseCase.execute(walletId);
    }
}