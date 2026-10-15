import { Controller, Post, Get, Param, Body, Query, UseGuards, HttpCode } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { ProviderIdentityGuard } from "../guard/provider-identity.guard";

import { WalletNotFoundError, InvalidInputError } from "../../domain/common/errors";
import { UuidParamPipe } from "../validation/uuid-param.pipe";
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
    async getWallet(@Param("walletId", UuidParamPipe) walletId: string)
    {
        const forkEm = this.em.fork();
        const wallet = await forkEm.findOne(WalletEntity, { id: walletId });
        if (!wallet) throw new WalletNotFoundError(walletId);

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
    async getLedger( @Param("walletId", UuidParamPipe) walletId: string, @Query("cursor") cursor?: string, @Query("limit") limit?: string)
    {
        const parsedLimit = limit === undefined ? 50 : Number(limit);
        if (limit !== undefined && (limit.trim() === "" || !Number.isInteger(parsedLimit))) throw new InvalidInputError("Parâmetro 'limit' deve ser um inteiro");
        return await this.getWalletLedgerUseCase.execute(walletId, cursor, parsedLimit);
    }

    @Post(":walletId/reconciliation")
    @HttpCode(200)
    async reconcile(@Param("walletId", UuidParamPipe) walletId: string)
    {
        return await this.reconcileWalletUseCase.execute(walletId);
    }
}