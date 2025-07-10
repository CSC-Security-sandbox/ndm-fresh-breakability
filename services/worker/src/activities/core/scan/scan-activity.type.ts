import { JobConfig } from "@local/job-lib/dist/job-manager/data-store/jobconfig/job-config";
import { Command, JobManagerContext, Task } from "@netapp-cloud-datamigrate/jobs-lib";


export interface ScanActivityInput {
    jobRunId: string;
    dirsToScan: string[];
    isMigration: boolean;
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
    jobConfig: JobConfig;
    jobRunId: string;
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
    jobRunId: string;
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
    jobConfig: JobConfig;
    activityId:string
    isMigration: boolean;
}