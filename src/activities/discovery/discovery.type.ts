import { Command, ErrorType, JobContext, Task } from "@netapp-cloud-datamigrate/jobs-lib";

export interface DiscoverPathInput{
    task: Task;
}
export interface DiscoverPathOutput{
    isFatalErrored : boolean
}

export interface DiscoveryInput {
    task: Task;
    jobContext: JobContext;
}

export interface DiscoveryOutput {
    errors: Set<string>;
    success: number;
    error: number
    retryCount: number
    isFatal: boolean;
}

export interface ScanDirCommandInput{
    sourcePath: string;
    sourcePrefix: string;
    excludePatterns: string[];
    command : Command;
    jobContext: JobContext;
    skipFile: string;
}

export interface ScanDirCommandOutput{
    files:  number,
    directory: number,
    isFatal: boolean;
    error: string | undefined;
    errorType?: ErrorType | undefined;
}