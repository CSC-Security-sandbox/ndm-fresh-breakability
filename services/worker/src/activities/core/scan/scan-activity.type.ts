import { Cmd, Command, ErrorType, JobManagerContext, Task, TaskInfo } from "@netapp-cloud-datamigrate/jobs-lib";


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
    totalSize: number;
    subDirs: string[];
    batchDirs: string[];
}

export interface ScanDirectoryInput {
    sourcePath: string;
    targetPath: string;
    sourcePrefix: string;
    targetPrefix:string
    jobContext: JobManagerContext;
    command: Cmd;
    settings: ScanDirectorySettings;
    errorType?: ErrorType;
}

export interface ScanDirectorySettings  {
    skipFile: string;
    excludePatterns: string[];
}

export interface ScanDirectoryOutput {
    fileCount: number;
    dirCount: number;
    totalSize: number;
    subDirs: string[];
}



export interface UpdateAndReportTaskInput {
    taskHashId: string;
    jobContext: JobManagerContext;
    errors:string[];
    task: TaskInfo,
    retryCount: number;
}

export interface TaskExecOutput {
    result: ScanActivityOutput; 
    errors: string[];
    retryCount: number;
}

export interface TaskExecInput {
    jobRunId:string;
    task:TaskInfo;
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
