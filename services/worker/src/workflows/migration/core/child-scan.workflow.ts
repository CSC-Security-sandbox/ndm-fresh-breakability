import { JobRunStatus } from "src/activities/discovery/enums";
import * as wf from '@temporalio/workflow';
import { CommonActivityService } from "src/activities/common/common.service";
import { ChildScanWorkflowInput } from "./chid-scan.workflow.type";
import { dir } from "console";


const {
  updateStatus: updateJobStatusActivity,
  getJobState: getJobStateActivity,
  setJobState: setJobStateActivity,
} = wf.proxyActivities<CommonActivityService>({
  startToCloseTimeout: '24h',
  heartbeatTimeout: '2m',
});

interface ScanWorkflowOutput{
  jobRunId: string;
  workers: string[];
  failedWorkers: string[];
  status: JobRunStatus;
  error?: string;
}

export const ChildScanWorkflow = async ({ jobRunId, dirsToScan = ['/'], batchSize = 100, dirCount = 0, fileCount = 0}: ChildScanWorkflowInput): Promise<ScanWorkflowOutput> => {
  
  await updateJobStatusActivity({jobRunId, status :JobRunStatus.Running});
  const jobState = await getJobStateActivity( jobRunId );
  const updatedJobState = {...jobState, status: JobRunStatus.Running};
  await setJobStateActivity(jobRunId, updatedJobState) // TBD - Create partial update activity

  while(dirsToScan.length > 0) {
    const batches: string[][] = [];
    for (let i = 0; i < dirsToScan.length; i += batchSize) {
      batches.push(dirsToScan.slice(i, i + batchSize));
    }

    

  }


  return null; 
}