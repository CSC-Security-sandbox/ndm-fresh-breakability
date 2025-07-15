import { ScanActivityInput } from "src/activities/core/scan/scan-activity.type";
import { JobRunStatus } from "src/activities/discovery/enums";

export interface ChildScanWorkflowInput {
    jobRunId: string;
    dirsToScan: string[];
    preBatchDirs: string[];
    batchSize: number;
    fileCount: number;
    dirCount: number;
    isMigration: boolean;
    actionState: JobRunStatus;
    isInitialScan?: boolean;
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



export interface ExecuteBatchScansOutput{
  fileCount: number;
  dirCount: number;
  batchDirs: string[];
  error?: string;
}

export interface CreateBatchInput {
  dirsToScan: string[];
  batchSize: number;
  preBatchDirs: string[];
  jobRunId: string;
  isMigration: boolean;
}

export interface ExecuteBatchScanInput  {
  batches: string[];
  jobRunId: string;
  isMigration: boolean;
  batchSize: number;
}

