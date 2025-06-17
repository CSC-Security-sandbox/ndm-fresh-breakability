export interface ChildScanWorkflowInput {
    jobRunId: string;
    dirsToScan: string[];
    batchSize: number;
    fileCount: number;
    dirCount: number;
}

export interface ChildScanWorkflowOutput {
    jobRunId: string;
    batchSize: number;
    fileCount: number;
    dirCount: number;
}