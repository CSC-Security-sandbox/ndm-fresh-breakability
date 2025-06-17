import { JobRunStatus } from "src/activities/discovery/enums";


interface ScanWorkflowOutput{
  jobRunId: string;
  workers: string[];
  failedWorkers: string[];
  status: JobRunStatus;
  error?: string;
}

export const ChildScanWorkflow = async({jobRunId }): Promise<ScanWorkflowOutput> => {
    
    return null; 
}