import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";

import { InvalidInputError } from "../../../domain/shared/errors";

import { GetWalletLedgerUseCase } from "../../../application/usecases/get-wallet-ledger.usecase";
import { GetWalletUseCase } from "../../../application/usecases/get-wallet.usecase";
import { OpenWalletUseCase } from "../../../application/usecases/open-wallet.usecase";
import { ReconcileWalletUseCase } from "../../../application/usecases/reconcile-wallet.usecase";

import type { CreateWalletRequest } from "../dto/requests";

import { AuthGuard } from "../guards/auth.guard";

import { UuidParamPipe } from "../pipes/uuid-param.pipe";

@Controller("wallets")
@UseGuards(AuthGuard)
export class WalletsController
{
    constructor(
        private readonly openWallet: OpenWalletUseCase,
        private readonly getWallet: GetWalletUseCase,
        private readonly getLedger: GetWalletLedgerUseCase,
        private readonly reconcile: ReconcileWalletUseCase,
    ) {}

    @Post()
    create(@Body() body: CreateWalletRequest)
    {
        return this.openWallet.execute(body);
    }

    @Get(":walletId")
    get(@Param("walletId", UuidParamPipe) walletId: string)
    {
        return this.getWallet.execute(walletId);
    }

    @Get(":walletId/ledger")
    ledger(@Param("walletId", UuidParamPipe) walletId: string, @Query("cursor") cursor?: string, @Query("limit") limit?: string)
    {
        const parsedLimit = limit === undefined ? undefined : Number(limit);
        if (limit !== undefined && (limit.trim() === "" || !Number.isInteger(parsedLimit))) throw new InvalidInputError("Parâmetro 'limit' deve ser um inteiro");

        return this.getLedger.execute(walletId, cursor, parsedLimit);
    }

    @Post(":walletId/reconciliation")
    @HttpCode(200)
    reconciliation(@Param("walletId", UuidParamPipe) walletId: string)
    {
        return this.reconcile.execute(walletId);
    }
}