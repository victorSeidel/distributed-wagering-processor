import { Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { GetQueueAttributesCommand } from "@aws-sdk/client-sqs";

import { SqsClientService } from "../messaging/sqs/sqs-client.service";

export interface ReadinessReport
{
    ready: boolean;
    checks: { postgres: boolean; sqs: boolean };
}

@Injectable()
export class ReadinessService
{
    constructor(
        private readonly em: EntityManager,
        private readonly sqs: SqsClientService,
    ) {}

    public async check(): Promise<ReadinessReport>
    {
        const [postgres, sqs] = await Promise.all([this.checkPostgres(), this.checkSqs()]);
        return { ready: postgres && sqs, checks: { postgres, sqs } };
    }

    private async checkPostgres(): Promise<boolean>
    {
        try
        {
            await this.em.fork().execute("SELECT 1");
            return true;
        }
        catch
        {
            return false;
        }
    }

    private async checkSqs(): Promise<boolean>
    {
        try
        {
            const urls = [this.sqs.commandsQueueUrl, this.sqs.eventsQueueUrl];
            if (!urls.every(Boolean)) return false;

            await Promise.all(urls.map((QueueUrl) => this.sqs.getClient().send(new GetQueueAttributesCommand({ QueueUrl, AttributeNames: ["QueueArn"] }))));
            return true;
        }
        catch
        {
            return false;
        }
    }
}