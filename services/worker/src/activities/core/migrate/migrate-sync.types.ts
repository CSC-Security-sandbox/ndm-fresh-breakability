import { Command, CommandOperation, ErrorType, JobManagerContext, MetaData, OPS_STATUS, Task, TaskStatus } from "@netapp-cloud-datamigrate/jobs-lib";

export interface SyncTaskOutput {
    errors: {
        source: string[]
        target: string[]
    };
    status: TaskStatus;
    error: number,
    retryCount: number;
}


export interface SyncTaskInput {
    jobRunId: string,
    taskId: string;
}

export interface StampMetaDataInput {
    targetPath: string;
    sourcePath: string;
    metadata: MetaData; 
    jobContext: JobManagerContext,
    command: Command, 
    errorType: ErrorType
}

export interface StampMetaDataOutput {
    sourceErrors: string[],
    targetErrors: string[],
    errorType: ErrorType
}

export interface SyncOperationInput {
    sourcePath: string;
    targetPath: string;
    ops: Record<number, CommandOperation>;
    jobContext: JobManagerContext;
    command: Command;
    errorType?: ErrorType | undefined
}


export interface SyncOperationOutput {
    status: OPS_STATUS;
    ops: Record<number, CommandOperation>
    errors: {
        source: Set<string>,
        target: Set<string>
    }
    checksums?:{
        sourceChecksum?: string,
        targetChecksum?:string
    }
    errorType?: ErrorType | undefined;
}

export interface handleSyncTaskUpdateInput {
    taskHashId: string;
    jobContext: JobManagerContext;
    errors: {
        source: string[];
        target: string[];
    }
    task: Task,
    retryCount: number;
}


export interface handleInitTaskInput {
    task: Task;
    jobContext: JobManagerContext;
}