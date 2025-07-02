import { JobRunStatus } from "src/activities/discovery/enums";

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
  status: JobRunStatus;
  fileCount : number;
  dirCount : number;
  error?: string;
}

export enum ScanWorkflowStatus{    
    Completed = 'Completed',
    Failed = 'Failed',
    Running = 'Running',
}

export enum WorkflowStatus {
    Completed = 'Completed',
    Failed = 'Failed',
    Stopped = 'Stopped',
}

export interface ScanWorkflowOutput{
  jobRunId: string;
  status: JobRunStatus;
  fileCount : number;
  dirCount : number;
  error?: string;
}

export interface SyncWorkflowOutput{
    jobRunId: string;
    status: JobRunStatus;
    error?: string;
}

