import { Command, ErrorType, JobContext, JobManagerContext, Task } from "@netapp-cloud-datamigrate/jobs-lib";
import { Origin } from "src/activities/utils/utils.types";


export interface ScanActivityInput {
    jobRunId: string;
    dirsToScan: string[];
}
export interface ScanActivityOutput {
    jobRunId: string;
    fileCount: number;
    dirCount: number;
    subDirs: string[];
}

export interface ScanDirectoryInput {
    sourcePath: string;
    targetPath: string;
    sourcePrefix: string;
    jobContext: JobManagerContext;
    command: Command;
    settings: ScanDirectorySettings;
}

export interface ScanDirectorySettings  {
    skipFile: string;
    excludePatterns: string[];
}

export interface ScanDirectoryOutput {
    fileCount: number;
    dirCount: number;
    subDirs: string[];
}

export interface PublishCommandInput{
    jobContext: JobManagerContext;
    commands: Command[]
}

export interface DirContentsInput {
    jobContext: JobManagerContext;
    path: string;
    origin: Origin;
    errorType?: ErrorType;
    command?: Command;
}

export interface UpdateAndReportTaskInput {
    taskHashId: string;
    jobContext: JobManagerContext;
    errors:string[];
    task: Task,
    retryCount: number;
}