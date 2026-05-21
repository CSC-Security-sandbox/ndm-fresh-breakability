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
    isFileStreamLenValid: isFileStreamLenValidActivity,
} = wf.proxyActivities<CommonTaskService>({
  startToCloseTimeout: '5m',
  heartbeatTimeout: '1m',
  retry: { maximumAttempts: 3, initialInterval: '30s', backoffCoefficient: 1 }
});

/** Abort stream length polling after this many consecutive activity failures (avoids infinite retry). */
const MAX_CONSECUTIVE_STREAM_VALIDATION_ERRORS = 5;

/** Latest job action from scan signal; when not {@link JobRunStatus.Running}, polling exits before the next activity or after a full inter-poll sleep (never mid-sleep). */
export type GetScanActionStateFn = () => JobRunStatus;

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
 *
 * @returns Number of workflow history contributors: one per validation activity
 * plus one per sleep while waiting.
 */
export async function validateCommandStreamLength(
  jobRunId: string,
  getActionState: GetScanActionStateFn
): Promise<number> {
  let steps = 0;
  let consecutiveErrors = 0;
  while (true) {
    try {
      if (getActionState() === JobRunStatus.Paused) {
        await updateJobStatusActivity({ jobRunId, status: JobRunStatus.Paused });
        await wf.condition(() => getActionState() !== JobRunStatus.Paused);
      }
      if (getActionState() !== JobRunStatus.Running) {
        return steps;
      }
      steps += 1;
      if (await isCmdStreamLenValidActivity(jobRunId)) {
        return steps;
      }
      console.warn(`[WARNING] For jobRunId ${jobRunId}, Waiting for command stream to be valid.`);
      await wf.sleep('30s');
      steps += 1;
      consecutiveErrors = 0;
    } catch (error: unknown ) {
      if (wf.isCancellation(error)) {
        throw error;
      }
      consecutiveErrors += 1;
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[ERROR] Error validating command stream length for jobRunId ${jobRunId}: ${errorMessage}`);
      if (consecutiveErrors >= MAX_CONSECUTIVE_STREAM_VALIDATION_ERRORS) {
        throw error;
      }
    }
  }
}

/**
 * Validates Redis file stream length for discovery scans.
 * Waits until consumers reduce XLEN below configured maxDiscoveryFileStreamLen.
 *
 * @returns Number of workflow history contributors: one per validation activity
 * plus one per sleep while waiting.
 */
export async function validateFileStreamLength(
  jobRunId: string,
  getActionState: GetScanActionStateFn
): Promise<number> {
  let steps = 0;
  let consecutiveErrors = 0;
  while (true) {
    try {
      if (getActionState() === JobRunStatus.Paused) {
        await updateJobStatusActivity({ jobRunId, status: JobRunStatus.Paused });
        await wf.condition(() => getActionState() !== JobRunStatus.Paused);
      }
      if (getActionState() !== JobRunStatus.Running) {
        return steps;
      }
      steps += 1;
      if (await isFileStreamLenValidActivity(jobRunId)) {
        return steps;
      }
      console.warn(`[WARNING] For jobRunId ${jobRunId}, Waiting for file stream length to be valid.`);
      await wf.sleep('30s');
      steps += 1;
      consecutiveErrors = 0;
    } catch (error: unknown) {
      if (wf.isCancellation(error)) {
        throw error;
      }
      consecutiveErrors += 1;
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[ERROR] Error validating file stream length for jobRunId ${jobRunId}: ${errorMessage}`);
      if (consecutiveErrors >= MAX_CONSECUTIVE_STREAM_VALIDATION_ERRORS) {
        throw error;
      }
    }
  }
}
