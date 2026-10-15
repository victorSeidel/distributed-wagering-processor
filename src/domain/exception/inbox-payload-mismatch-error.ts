export class InboxPayloadMismatchError extends Error
{
    constructor(consumerName: string, messageId: string)
    {
        super(`Inbox ${consumerName}/${messageId} reentregue com payload diferente do original`);
        this.name = "InboxPayloadMismatchError";
    }
}