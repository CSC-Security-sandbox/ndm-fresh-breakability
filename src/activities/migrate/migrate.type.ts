import { JobContext, Task } from "@netapp-cloud-datamigrate/jobs-lib";

export interface SyncContentInput{
    sourcePath: string;
    targetPath: string;
    sourcePrefix: string;
    excludePatterns: string[];
    jobContext: JobContext
}

export interface SyncContentOutput{
    files: string[],
    directory: string[]
}

export interface FetchScanTaskInput {
    jobContext: JobContext,
    jobRunId: string
}

export interface FetchScanTaskOutPut {
    tasks: Task[]
}