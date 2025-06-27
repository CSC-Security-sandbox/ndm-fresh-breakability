export interface ChildScanWorkflowInput {
    jobRunId: string;
    dirsToScan: string[];
    batchSize: number;
    fileCount: number;
    dirCount: number;
    isMigration: boolean;
}

export interface ChildScanWorkflowOutput {
    jobRunId: string;
    batchSize: number;
    fileCount: number;
    dirCount: number;
}