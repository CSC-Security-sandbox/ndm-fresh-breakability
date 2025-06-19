import { Command, JobContext, JobManagerContext } from "@netapp-cloud-datamigrate/jobs-lib";


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
    jobRunId: string;
    sourcePath: string;
    targetPath: string;
    sourcePrefix: string;
    excludePatterns: string[];
    jobContext: JobManagerContext;
    skipFile: string;
}

export interface ScanDirectoryOutput {
    jobRunId: string;
    fileCount: number;
    dirCount: number;
    subDirs: string[];
}

export interface PublishCommandInput{
    jobContext: JobManagerContext;
    commands: Command[]
}