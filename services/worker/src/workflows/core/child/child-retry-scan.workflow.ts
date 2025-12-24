import * as wf from '@temporalio/workflow';
import { CommonActivityService } from "src/activities/common/common.service";
import { RetryActivityService } from 'src/activities/core/retry/retry-activity.service';
import { JobRunStatus } from "src/activities/common/enums";
import { updateJobStatusIfNotRunning, validateCommandStreamLength } from '../common/workflow-utils';
import { 
  ChildRetryScanWorkflowInput, 
  ChildRetryScanWorkflowOutput 
} from './child-retry-scan.workflow.type';


const {
  updateStatus: updateJobStatusActivity,
} = wf.proxyActivities<CommonActivityService>({
  startToCloseTimeout: '24h',
  heartbeatTimeout: '2m',
  retry: { maximumAttempts: 3, initialInterval: '30s', backoffCoefficient: 1 }
});


const {
  fetchRetryBatch: fetchRetryBatchActivity
} = wf.proxyActivities<RetryActivityService>({
  startToCloseTimeout: '24h',
  heartbeatTimeout: '2m',
  retry: { 
    maximumAttempts: 3, 
    initialInterval: '10s', 
    backoffCoefficient: 2.0,
    nonRetryableErrorTypes: ['ApplicationFailure', 'FatalError' , '']
  }
});


const retryScanActionSignal = wf.defineSignal<[JobRunStatus]>('retryScanActionSignal');


const ITERATIONS_LIMIT = 1000;
const CMD_LENGTH_VALIDATION_ITERATIONS = 5;


/**
 * ChildRetryScanWorkflow - Handles batch processing of failed operations for retry.
 * 
 * This workflow follows the same pattern as ChildScanWorkflow:
 * 1. Fetches failed operations in batches from the jobs-service API
 * 2. Creates Cmd objects from failed operations (no file system access)
 * 3. Publishes commands to Redis stream for sync workflow to process
 * 4. Uses cursor-based pagination with Redis checkpoint for resumability
 * 5. Supports continueAsNew for long-running retries
 * 
 * Unlike the normal scan workflow, this workflow:
 * - Does NOT access the file system
 * - Creates commands directly from failed operation records
 * - Uses cursor-based API pagination instead of directory traversal
 */
export const ChildRetryScanWorkflow = async ({ 
  jobRunId,
  originalJobRunId,
  actionState = JobRunStatus.Running
}: ChildRetryScanWorkflowInput): Promise<ChildRetryScanWorkflowOutput> => {

  // Use originalJobRunId to fetch failed operations, default to jobRunId if not provided
  const sourceJobRunId = originalJobRunId || jobRunId;

  // Update status to RUNNING at start
  await updateJobStatusActivity({ jobRunId, status: JobRunStatus.Running });

  const retryScanWorkflowOutput: ChildRetryScanWorkflowOutput = {
    jobRunId,
    status: JobRunStatus.Running,
    error: undefined,
  };

  // Handle stop/pause signals
  wf.setHandler(retryScanActionSignal, async (action: JobRunStatus) => {    
    actionState = action;
    console.log(jobRunId, `retry scan action signal called with value: ${action}`);
  });

  let isStopRequested = false;
  let errors: string[] = [];
  let iterations = 0;
  let hasMore = true;

  // Main processing loop
  while (hasMore) {

    // Handle stop request
    if (actionState === JobRunStatus.Stopped) {
      isStopRequested = true;
      console.log(`Stopping ChildRetryScanWorkflow ${jobRunId} as requested. ${actionState}`);
      break;
    }

    // Wait if paused
    await updateJobStatusIfNotRunning(actionState, jobRunId);
    await wf.condition(() => actionState !== JobRunStatus.Paused);

    // Validate command stream length periodically to prevent overflow
    iterations += CMD_LENGTH_VALIDATION_ITERATIONS;
    await validateCommandStreamLength(jobRunId);

    // Fetch and process one batch of failed operations
    try {
      const batchResult = await fetchRetryBatchActivity({ 
        jobRunId,           // New job run ID for Redis context
        originalJobRunId: sourceJobRunId  // Original job run ID to fetch failed ops from
      });
      
      hasMore = batchResult.hasMore;
      iterations++;

    } catch (error) {
      console.error(`[ERROR] Error in fetchRetryBatchActivity: ${error.message}`);
      errors.push(error.message);
      hasMore = false;
      throw error;
    }

    // Check iteration limit for continueAsNew
    if (iterations > ITERATIONS_LIMIT && hasMore) {
      console.warn(`ChildRetryScanWorkflow ${jobRunId} has exceeded ${ITERATIONS_LIMIT} iterations, continuing as new.`);
      await wf.continueAsNew({ 
        jobRunId,
        originalJobRunId: sourceJobRunId,
        actionState
      });
    }
  }

  // Determine final status
  if (errors.length > 0) {
    console.log(`[ERROR] ChildRetryScanWorkflow ${jobRunId} encountered errors: ${errors.join(', ')}`);
    retryScanWorkflowOutput.error = errors.join(', ');
    retryScanWorkflowOutput.status = JobRunStatus.Errored;
  } else {
    retryScanWorkflowOutput.status = isStopRequested ? JobRunStatus.Stopped : JobRunStatus.Completed;
  }

  return retryScanWorkflowOutput;
};
