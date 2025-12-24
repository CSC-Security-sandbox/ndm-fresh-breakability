import * as wf from '@temporalio/workflow';
import { getExternalWorkflowHandle } from '@temporalio/workflow';
import { CommonActivityService } from 'src/activities/common/common.service';
import { JobRunStatus } from 'src/activities/common/enums';
import { CommonTaskService } from 'src/activities/core/common/common-task.service';


const {
  updateStatus: updateJobStatusActivity,
  
} = wf.proxyActivities<CommonActivityService>({
  startToCloseTimeout: '24h',
  heartbeatTimeout: '2m',
  retry: { maximumAttempts: 3, initialInterval: '30s', backoffCoefficient: 1 }
});

const {
    isWorkflowRunningActivity: isWorkflowRunningActivity,
    isCmdStreamLenValid: isCmdStreamLenValidActivity,
} = wf.proxyActivities<CommonTaskService>({
  startToCloseTimeout: '5m',
  heartbeatTimeout: '1m',
  retry: { maximumAttempts: 3, initialInterval: '30s', backoffCoefficient: 1 }
});


export const updateJobStatusIfNotRunning = async (state: JobRunStatus, jobRunId: string) => {
  if(state !== JobRunStatus.Running) {
    await updateJobStatusActivity({jobRunId, status: state});
  }
}

export const cancelWorkflowIfRunning = async (workflowId: string) =>{
  try{  
    const isWorkflowRunning  =  await isWorkflowRunningActivity(workflowId);
    if(!isWorkflowRunning){
      console.log(`${workflowId} is not running`);
      return;
    }          
    const handle = getExternalWorkflowHandle(workflowId);
    await handle.cancel();
    console.log(`${workflowId} is cancelled sucessfully`);
  }catch(error){
    console.log(`Failed to cancel workflow ${workflowId}`);
  } 
}

export const signalIfRunning = async (workflow: any, signalName: string, payload: any) => {
  try {
    if (workflow && await isWorkflowRunningActivity(workflow.workflowId)) {
      await workflow.signal(signalName, payload);
    }
  } catch (error) {
    console.log(`Failed to signal workflow ${workflow?.workflowId} with signal ${signalName}: ${error.message}`);
  }
}

/**
 * Determines the unified job status based on scan and sync statuses.
 * Used by both normal migration and retry migration workflows.
 */
export const getUnifiedJobStatus = (scanStatus: JobRunStatus, syncStatus: JobRunStatus): JobRunStatus => {
  if (scanStatus === JobRunStatus.Failed || syncStatus === JobRunStatus.Failed) {
    return JobRunStatus.Failed;
  }
  if (scanStatus === JobRunStatus.Stopped || syncStatus === JobRunStatus.Stopped) {
    return JobRunStatus.Stopped;
  }
  return JobRunStatus.Completed;
};

/**
 * Validates that the command stream length is within acceptable limits.
 * Waits if the stream is too long to prevent memory overflow.
 * Shared by ChildScanWorkflow and ChildRetryScanWorkflow.
 */
export async function validateCommandStreamLength(jobRunId: string): Promise<void> {
  let checkCount = 0;
  const maxChecks = 100;

  while (checkCount < maxChecks) {
    checkCount++;
    try {
      const isCmdStreamLenValid = await isCmdStreamLenValidActivity(jobRunId);
      if (isCmdStreamLenValid) break;
      console.warn(`[WARNING] For jobRunId ${jobRunId}, Waiting for command stream to be valid.`);
      await wf.sleep('30s');
    } catch (error) {
      console.error(`[ERROR] Error validating command stream length for jobRunId ${jobRunId}: ${error.message}`);
    }
  }
  if (checkCount >= maxChecks) {
    console.warn(`[WARNING] For jobRunId ${jobRunId}, Maximum checks reached. Exiting validation loop.`);
  }
}
