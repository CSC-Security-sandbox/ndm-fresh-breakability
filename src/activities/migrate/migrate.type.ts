import { JobContext, Task } from "@netapp-cloud-datamigrate/jobs-lib";
import { Logger } from "src/logger/logger.service";

export interface ScanContentInput{
    sourcePath: string;
    targetPath: string;
    sourcePrefix: string;
    excludePatterns: string[];
    jobContext: JobContext
    logger: Logger
}
export interface ScanContentOutput{
    files: string[],
    directory: string[]
}

export interface FetchScanTaskInput {
    jobContext: JobContext,
    jobRunId: string
    logger: Logger
}
export interface FetchScanTaskOutPut {
    tasks: Task[]

}


export interface ScanPathInput{
    task: Task;
    jobContext: JobContext;
    logger: Logger
}
export interface ScanPathOutput{
    isTaskCreated: boolean
}


export interface PublishScanTaskInput{
    jobRunId: string;
    jobContext: JobContext;
    logger: Logger
}