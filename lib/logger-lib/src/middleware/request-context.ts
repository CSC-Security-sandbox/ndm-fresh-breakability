import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContextData {
    trackId: string;
}

export class RequestContext {
    private static asyncLocalStorage = new AsyncLocalStorage<RequestContextData>();

    static run(context: RequestContextData, callback: () => void) {
        this.asyncLocalStorage.run(context, callback);
    }

    static getContext(): RequestContextData | undefined {
        return this.asyncLocalStorage.getStore();
    }

    static getTrackId(): string | undefined {
        return this.getContext()?.trackId;
    }
}