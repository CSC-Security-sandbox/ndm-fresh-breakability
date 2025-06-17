import { Command, JobContext } from "@netapp-cloud-datamigrate/jobs-lib";


export interface ScanActivityInput {
    jobRunId: string;
    dirsToScan: string[];
}
export interface ScanActivityOutput {
    jobRunId: string;
    fileCount: number;
    dirCount: number;
}

export interface ScanDirectoryInput {
    jobRunId: string;
    sourcePath: string;
    targetPath: string;
    sourcePrefix: string;
    excludePatterns: string[];
    jobContext: JobContext;
    skipFile: string;
}

export interface ScanDirectoryOutput {
    jobRunId: string;
    fileCount: number;
    dirCount: number;
    command: Command[];
}