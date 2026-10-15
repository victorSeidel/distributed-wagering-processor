import { Controller, Get, Res, HttpStatus } from "@nestjs/common";
import type { Response } from "express";
import { EntityManager } from "@mikro-orm/postgresql";

import { GetQueueAttributesCommand } from "@aws-sdk/client-sqs";
import { SqsService } from "../../infra/messaging/sqs-client.service";

@Controller("health")
export class HealthController
{
    constructor(
        private readonly em: EntityManager,
        private readonly sqsService: SqsService,
    ) {}

    @Get("live")
    live(@Res() res: Response)
    {
        return res.status(HttpStatus.OK).json({ status: "UP", timestamp: new Date().toISOString() });
    }

    @Get("ready")
    async ready(@Res() res: Response)
    {
        const checks: { postgres: boolean; sqs: boolean } = { postgres: false, sqs: false };

        try
        {
            const forkEm = this.em.fork();
            await forkEm.getConnection().execute("SELECT 1");
            checks.postgres = true;
        }
        catch
        {
            checks.postgres = false;
        }

        try
        {
            const client = this.sqsService.getClient();
            const queueUrls = [this.sqsService.getQueueUrl(), this.sqsService.getEventsQueueUrl()];
            if (client && queueUrls.every(Boolean))
            {
                await Promise.all(queueUrls.map((QueueUrl) => client.send(new GetQueueAttributesCommand({ QueueUrl, AttributeNames: ["QueueArn"] }))));
                checks.sqs = true;
            }
        }
        catch
        {
            checks.sqs = false;
        }

        const isHealthy = checks.postgres && checks.sqs;
        const status = isHealthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
        return res.status(status).json({ status: isHealthy ? "READY" : "NOT_READY", checks, timestamp: new Date().toISOString() });
    }
}