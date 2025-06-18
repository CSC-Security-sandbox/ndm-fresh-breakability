export interface SyncTaskOutput {
    errors: {
        source: string[]
        target: string[]
    };
    success: number;
    error: number,
    retryCount: number;
    isFatal : boolean
}


export interface SyncTaskInput {
    jobRunId: string,
    taskId: string;
}