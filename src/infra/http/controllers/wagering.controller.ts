import { Body, Controller, Get, Headers, HttpStatus, Param, Post, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";

import { WagerTransactionStatus } from "../../../domain/wager/wager-transaction.types";
import { InvalidInputError } from "../../../domain/shared/errors";

import { GetWagerTransactionUseCase } from "../../../application/usecases/get-wager-transaction.usecase";
import { ProcessWagerUseCase } from "../../../application/usecases/process-wager.usecase";

import type { SubmitWagerTransactionRequest } from "../dto/requests";

import { AuthGuard } from "../guards/auth.guard";

import { UuidParamPipe } from "../pipes/uuid-param.pipe";

import { RequestContext } from "../../observability/request-context";

@Controller()
@UseGuards(AuthGuard)
export class WageringController
{
    constructor(
        private readonly processWager: ProcessWagerUseCase,
        private readonly getTransaction: GetWagerTransactionUseCase,
    ) {}

    @Post("wagering/transactions")
    async submit(@Body() body: SubmitWagerTransactionRequest, @Headers("idempotency-key") idempotencyKey: string | undefined, @Res() res: Response)
    {
        if (!idempotencyKey?.trim()) throw new InvalidInputError("Header 'Idempotency-Key' é obrigatório");

        const result = await this.processWager.execute({ ...body, idempotencyKey, correlationId: RequestContext.correlationId() }, { channel: "http" });

        if (result.status === WagerTransactionStatus.Rejected) return res.status(HttpStatus.UNPROCESSABLE_ENTITY).json(result);
        if (result.status === WagerTransactionStatus.PendingReference) return res.status(HttpStatus.ACCEPTED).json(result);

        return res.status(HttpStatus.OK).json(result);
    }

    @Get("wagering/transactions/:transactionId")
    byId(@Param("transactionId", UuidParamPipe) transactionId: string)
    {
        return this.getTransaction.byId(transactionId);
    }

    @Get("providers/:providerId/wagering/transactions/:externalTransactionId")
    byExternalId(@Param("providerId") providerId: string, @Param("externalTransactionId") externalTransactionId: string)
    {
        return this.getTransaction.byExternalId(providerId, externalTransactionId);
    }
}