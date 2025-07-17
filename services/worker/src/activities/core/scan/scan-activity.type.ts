import { Command, JobManagerContext, Task } from "@netapp-cloud-datamigrate/jobs-lib";


export interface ScanActivityInput {
    jobRunId: string;
    isMigration: boolean;
    batchSize: number;
    batchId: string;
}

export interface ScanActivityOutput {
    jobRunId: string;
    fileCount: number;
    dirCount: number;
    subDirs: string[];
    batchDirs: string[];
}

export interface ScanDirectoryInput {
    sourcePath: string;
    targetPath: string;
    sourcePrefix: string;
    targetPrefix:string
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



export interface UpdateAndReportTaskInput {
    taskHashId: string;
    jobContext: JobManagerContext;
    errors:string[];
    task: Task,
    retryCount: number;
}

export interface TaskExecOutput {
    result: ScanActivityOutput; 
    errors: string[];
    retryCount: number;
}

export interface TaskExecInput {
    jobRunId:string;
    task:Task;
    jobContext: JobManagerContext;
    activityId:string
    isMigration: boolean;
    batchSize: number;
}

export interface BatchSubDirInput {
    subDirs: string[];
    batchSize: number;
    jobContext: JobManagerContext;
}

export interface BatchSubDirOutput {
    subDirs: string[];
    batchDirs: string[];
}
