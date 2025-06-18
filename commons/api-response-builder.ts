// api-response-builder.ts

import { ApiResponse } from './api-response.interface';

export class ApiResponseBuilder<T = any> {
    private response: ApiResponse<T>;

    constructor() {
        this.response = {
            success: true,
            statusCode: 200,
            message: '',
            timestamp: new Date().toISOString(),
        };
    }

    setSuccess(success: boolean): this {
        this.response.success = success;
        return this;
    }

    setStatusCode(statusCode: number): this {
        this.response.statusCode = statusCode;
        return this;
    }

    setMessage(message: string): this {
        this.response.message = message;
        return this;
    }

    setData(data: any): this {
        this.response.data = data;
        return this;
    }

    setError(error: ApiResponse<T>['error']): this {
        this.response.error = error;
        return this;
    }

    setErrorFields(params: {
        errorMessage: string;
        displayMessage?: string;
        details?: any;
        code?: string | number;
        stack?: string;
    }): this {
        this.response.error = { ...params };
        return this;
    }

    setMeta(meta: Record<string, any>): this {
        this.response.data.meta = meta;
        return this;
    }

    setTimestamp(timestamp: string): this {
        this.response.timestamp = timestamp;
        return this;
    }

    setPath(path: string): this {
        this.response.path = path;
        return this;
    }

    build(): ApiResponse<T> {
        // Return a shallow copy to prevent mutation
        return { ...this.response };
    }

    reset(): this {
        this.response = {
            success: true,
            statusCode: 200,
            message: '',
            timestamp: new Date().toISOString(),
        };
        return this;
    }
}