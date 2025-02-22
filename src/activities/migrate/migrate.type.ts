import { CommandOperation, JobContext, Task, TaskStatsType } from "@netapp-cloud-datamigrate/jobs-lib";
import { Logger } from "src/logger/logger.service";
import { JobRunStatus, OperationStatus } from "../discovery/enums";

export interface ScanContentInput{
    jobRunId: string;
    sourcePath: string;
    targetPath: string;
    sourcePrefix: string;
    excludePatterns: string[];
    jobContext: JobContext;
}
export interface ScanContentOutput{
    files:  number,
    directory: number,
    isGeneratedTask: boolean;
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
    isTaskCreated: boolean
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
    status: 'COMPLETE' | 'ERROR'
}

export interface SyncOperationInput {
    sourcePath: string;
    targetPath: string;
    // jobRunId:string;
    ops: Record<number, CommandOperation>
}

export interface SyncOperationOutput {
    Status: OperationStatus;
    ops: Record<number, CommandOperation>
}

export interface UpdateStatusInput{
    jobRunId: string;
    status: JobRunStatus
}

export interface UpdateStatusOutput{
    message: string;
}