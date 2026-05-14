import * as wf from '@temporalio/workflow';
import { getExternalWorkflowHandle, WorkflowNotFoundError } from '@temporalio/workflow';
import { CommonActivityService } from 'src/activities/common/common.service';
import { JobRunStatus } from 'src/activities/common/enums';
import { CommonTaskService } from 'src/activities/core/common/common-task.service';
import { SIGNAL_MAX_ATTEMPTS, SIGNAL_RETRY_DELAY } from './workflow-constants';


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

export const cancelWorkflowIfRunning = async (workflowId: string): Promise<void> => {
  const isWorkflowRunning = await isWorkflowRunningActivity(workflowId);
  if (!isWorkflowRunning) {
    console.log(`${workflowId} is not running`);
    return;
  }

  const handle = getExternalWorkflowHandle(workflowId);
  for (let attempt = 1; attempt <= SIGNAL_MAX_ATTEMPTS; attempt++) {
    try {
      await handle.cancel();
      console.log(`${workflowId} cancelled successfully`);
      return;
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) {
        console.log(`${workflowId} already completed before cancel could be sent`);
        return;
      }
      if (attempt === SIGNAL_MAX_ATTEMPTS) {
        console.error(`Failed to cancel ${workflowId} after ${SIGNAL_MAX_ATTEMPTS} attempts: ${error.message}`);
        throw error;
      }
      console.warn(`Cancel attempt ${attempt} for ${workflowId} failed: ${error.message}. Retrying in ${SIGNAL_RETRY_DELAY}...`);
      await wf.sleep(SIGNAL_RETRY_DELAY);
    }
  }
}

export const signalIfRunning = async (workflow: any, signalName: string, payload: any): Promise<void> => {
  if (!workflow) return;

  const isRunning = await isWorkflowRunningActivity(workflow.workflowId);
  if (!isRunning) {
    console.log(`Workflow ${workflow.workflowId} is not running, skipping signal '${signalName}'`);
    return;
  }

  for (let attempt = 1; attempt <= SIGNAL_MAX_ATTEMPTS; attempt++) {
    try {
      await workflow.signal(signalName, payload);
      return;
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) {
        console.log(`Workflow ${workflow.workflowId} already completed before signal '${signalName}' could be sent`);
        return;
      }
      if (attempt === SIGNAL_MAX_ATTEMPTS) {
        console.error(`Failed to signal workflow ${workflow.workflowId} with signal '${signalName}' after ${SIGNAL_MAX_ATTEMPTS} attempts: ${error.message}`);
        throw error;
      }
      console.warn(`Signal attempt ${attempt} for ${workflow.workflowId} ('${signalName}') failed: ${error.message}. Retrying in ${SIGNAL_RETRY_DELAY}...`);
      await wf.sleep(SIGNAL_RETRY_DELAY);
    }
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
