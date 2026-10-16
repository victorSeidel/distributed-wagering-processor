import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContextData
{
    correlationId: string;
    messageId?: string;
}

const storage = new AsyncLocalStorage<RequestContextData>();

/**
 * Contexto de execução propagado por AsyncLocalStorage (HTTP e SQS).
 * O logger anexa 'correlationId' e 'messageId' a todo log emitido dentro dele, sem que cada função precise repassar esses valores.
 */
export const RequestContext =
{
    run<T>(data: RequestContextData, work: () => T): T
    {
        return storage.run(data, work);
    },

    current(): RequestContextData | undefined
    {
        return storage.getStore();
    },

    correlationId(): string | undefined
    {
        return storage.getStore()?.correlationId;
    },
};
