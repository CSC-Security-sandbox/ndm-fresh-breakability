import { JobContext, Task } from "@netapp-cloud-datamigrate/jobs-lib";
import { Logger } from "src/logger/logger.service";

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