import { AsyncLocalStorage } from 'async_hooks';
import {Inject, Injectable} from "@nestjs/common";

export interface RequestContextData {
    trackId: string;
    projectId: string;
}

@Injectable()
export class RequestContext {
    // Using AsyncLocalStorage to maintain context across asynchronous calls
    constructor(@Inject(AsyncLocalStorage) private readonly asyncLocalStorage: AsyncLocalStorage<RequestContextData>) {
    }

    run(context: RequestContextData, callback: () => void) {
        this.asyncLocalStorage.run(context, callback);
    }

    getContext(): RequestContextData | undefined {
        return this.asyncLocalStorage.getStore();
    }

    getTrackId(): string | undefined {
        return this.getContext()?.trackId;
    }

    getProjectId(): string | undefined {
        return this.getContext()?.projectId;
    }
}