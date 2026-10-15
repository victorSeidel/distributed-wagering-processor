import { Controller, Post, Get, Param, Body, Headers, UseGuards, Res, HttpStatus, NotFoundException, BadRequestException, } from "@nestjs/common";
import type { Response } from "express";

import { EntityManager } from "@mikro-orm/postgresql";
import { ProviderIdentityGuard } from "../guard/provider-identity.guard";

import type { SubmitWagerTransactionDto } from "../../model/dto/wager.dto";
import { WagerTransactionStatus } from "../../model/entity/wager.entity";
import { WagerTransactionEntity } from "../../infra/database/entities/wager-transaction.entity";

import { ProcessWagerUseCase } from "../usecase/process-wager.usecase";

@Controller()
@UseGuards(ProviderIdentityGuard)
export class WageringController
{
    constructor(
        private readonly processWagerUseCase: ProcessWagerUseCase,
        private readonly em: EntityManager,
    ) {}

    @Post("wagering/transactions")
    async submitTransaction(@Body() dto: SubmitWagerTransactionDto, @Headers("idempotency-key") idempotencyHeader: string | undefined, @Res() res: Response)
    {
        const idempotencyKey = idempotencyHeader;
        if (!idempotencyKey) throw new BadRequestException(`Header 'idempotency-key' é obrigatória`);

        const result = await this.processWagerUseCase.execute({ ...dto, idempotencyKey });

        if (result.status === WagerTransactionStatus.Rejected) return res.status(HttpStatus.UNPROCESSABLE_ENTITY).json(result);

        if (result.status === WagerTransactionStatus.PendingReference) return res.status(HttpStatus.ACCEPTED).json(result);

        return res.status(HttpStatus.OK).json(result);
    }

    @Get("wagering/transactions/:transactionId")
    async getTransaction(@Param("transactionId") transactionId: string)
    {
        const forkEm = this.em.fork();
        const tx = await forkEm.findOne(WagerTransactionEntity, { id: transactionId });
        if (!tx) throw new NotFoundException(`Transação '${transactionId}' não encontrada`);
        return tx;
    }

    @Get("providers/:providerId/wagering/transactions/:externalTransactionId")
    async getTransactionByExternal(@Param("providerId") providerId: string, @Param("externalTransactionId") externalTransactionId: string)
    {
        const forkEm = this.em.fork();
        const tx = await forkEm.findOne(WagerTransactionEntity, { providerId, externalTransactionId });
        if (!tx) throw new NotFoundException(`Transação externa '${externalTransactionId}' do provedor '${providerId}' não encontrada`);
        return tx;
    }
}