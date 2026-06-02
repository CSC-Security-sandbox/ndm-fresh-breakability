import * as wf from '@temporalio/workflow';
import { getExternalWorkflowHandle } from '@temporalio/workflow';
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
      const message = error?.message ?? String(error);
      // The workflow may have completed or been cancelled in the race window
      // between the running-check and this cancel. If it is no longer running,
      // there is nothing left to cancel, so treat it as success rather than a failure.
      if (!(await isWorkflowRunningActivity(workflowId))) {
        console.log(`${workflowId} is no longer running; treating cancel as complete`);
        return;
      }
      if (attempt === SIGNAL_MAX_ATTEMPTS) {
        console.error(`Failed to cancel ${workflowId} after ${SIGNAL_MAX_ATTEMPTS} attempts: ${message}`);
        throw error;
      }
      console.warn(`Cancel attempt ${attempt} for ${workflowId} failed: ${message}. Retrying in ${SIGNAL_RETRY_DELAY}...`);
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
      const message = error?.message ?? String(error);
      // The workflow may have completed or been cancelled in the race window
      // between the running-check and this signal. If it is no longer running,
      // there is nothing left to signal, so treat it as success rather than a failure.
      if (!(await isWorkflowRunningActivity(workflow.workflowId))) {
        console.log(`Workflow ${workflow.workflowId} is no longer running; skipping signal '${signalName}'`);
        return;
      }
      if (attempt === SIGNAL_MAX_ATTEMPTS) {
        console.error(`Failed to signal workflow ${workflow.workflowId} with signal '${signalName}' after ${SIGNAL_MAX_ATTEMPTS} attempts: ${message}`);
        throw error;
      }
      console.warn(`Signal attempt ${attempt} for ${workflow.workflowId} ('${signalName}') failed: ${message}. Retrying in ${SIGNAL_RETRY_DELAY}...`);
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
