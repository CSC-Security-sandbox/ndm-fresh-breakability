import { Command, CommandOperation, CommandStatus, ErrorType, JobContext, JobStatus, OPS_STATUS, Task } from "@netapp-cloud-datamigrate/jobs-lib";
import { JobRunStatus } from "../discovery/enums";


export interface ScanContentInput{
    jobRunId: string;
    sourcePath: string;
    targetPath: string;
    sourcePrefix: string;
    excludePatterns: string[];
    command : Command;
    jobContext: JobContext;
}
export interface ScanContentOutput{
    files:  number,
    directory: number,
    isGeneratedTask: boolean;
    error: string | undefined;
    errorType?: ErrorType | undefined;
}

export interface FetchScanTaskInput {
    jobRunId: string
}
export interface FetchScanTaskOutPut {
    tasks: Task[]
}

export interface ScanPathInput{
    task: Task;
}
export interface ScanPathOutput{
    isTaskCreated: boolean;
    errors: Set<string>;
    success: number;
    error: number
    retryCount: number
}

export interface PublishScanTaskInput{
    jobRunId: string;
}

export interface PublishScanTaskOutput{
    jobRunId: string;
    status :  'success' | 'error',
    message: string
}

export enum OPS_CMD {
    COPY_CONTENT = 'cc',
    STAMP_META  = 'sm',
    COPY_DIR = 'cd'
}

export interface FetchMigrationTaskInput {
    jobRunId: string
}

export interface FetchMigrationTaskOutput {
    tasks: Task[]
}

export interface SyncTaskInput {
    task: Task
}

export interface SyncTaskOutput {
    errors: Set<string>;
    success: number;
    error: number,
    retryCount: number;
    errorType?: ErrorType | undefined
}

export interface SyncOperationInput {
    sourcePath: string;
    targetPath: string;
    ops: Record<number, CommandOperation>;
    jobContext: JobContext;
    command: Command;
    errorType?: ErrorType | undefined
}

export interface SyncOperationOutput {
    status: OPS_STATUS;
    ops: Record<number, CommandOperation>
    errors: Set<string>
    checksums?:{
        sourceChecksum?: string,
        targetChecksum?:string
    }
    errorType?: ErrorType | undefined
}

export interface UpdateStatusInput{
    jobRunId: string;
    status: JobRunStatus
}

export interface UpdateStatusOutput{
    message: string;
}

export interface StampMetaDataOutput{
    errors: string[],
    errorType?: ErrorType | undefined
}

export interface UpdateCutOverStatusInput {
    jobRunId: string;
    status: CutOverStatus
}

export enum CutOverStatus {
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED'
}