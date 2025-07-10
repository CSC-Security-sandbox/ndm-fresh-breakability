import { JobConfig } from "@local/job-lib/dist/job-manager/data-store/jobconfig/job-config";
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
    jobRunId: string;
    command: Command, 
    errorType: ErrorType
    jobConfig: JobConfig
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
    jobRunId: string;
    command: Command;
    jobConfig: JobConfig
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
    jobRunId: string;
    errors: {
        source: string[];
        target: string[];
    }
    task: Task,
    retryCount: number;
}


export interface handleInitTaskInput {
    task: Task;
    jobRunId: string;
}