import * as wf from '@temporalio/workflow';
import { getExternalWorkflowHandle } from '@temporalio/workflow';
import { MappingResolverService } from 'src/activities/core/initializer/mapping-resolver.service';
import { CommonActivityService } from "src/activities/common/common.service";
import { JobRunStatus } from "src/activities/common/enums";
import { updateJobStatusIfNotRunning, validateCommandStreamLength } from '../common/workflow-utils';
import { ITERATIONS_LIMIT, DEFAULT_BATCH_SIZE } from '../common/workflow-constants';
import {
  ChildRetryScanWorkflowInput,
  ChildRetryScanWorkflowOutput,
  FetchFailedOperationsInput,
  FetchFailedOperationsOutput,
  ProcessRetryBatchInput,
  ProcessRetryBatchOutput,
  RetryScanSettings
} from './child-retry-scan.workflow.type';

/**
 * Interface for fetch failed operations activity.
 */
interface FetchFailedOperationsActivityType {
  fetchFailedOperations(input: FetchFailedOperationsInput): Promise<FetchFailedOperationsOutput>;
}

/**
 * Interface for process retry batch activity.
 */
interface ProcessRetryBatchActivityType {
  processRetryBatch(input: ProcessRetryBatchInput): Promise<ProcessRetryBatchOutput>;
}


const {
  updateStatus: updateJobStatusActivity,
} = wf.proxyActivities<CommonActivityService>({
  startToCloseTimeout: '24h',
  heartbeatTimeout: '2m',
  retry: { maximumAttempts: 3, initialInterval: '30s', backoffCoefficient: 1 }
});


const {
  resolveUsernamesToSids: resolveUsernamesToSidsActivity,
} = wf.proxyActivities<MappingResolverService>({
  startToCloseTimeout: '10m',
  retry: { maximumAttempts: 3, initialInterval: '30s', backoffCoefficient: 1 }
});

const {
  fetchFailedOperations: fetchFailedOperationsActivity,
} = wf.proxyActivities<FetchFailedOperationsActivityType>({
  startToCloseTimeout: '10m',
  heartbeatTimeout: '2m',
  retry: {
    maximumAttempts: 3,
    initialInterval: '10s',
    backoffCoefficient: 2.0,
    nonRetryableErrorTypes: ['ApplicationFailure', 'FatalError']
  }
});

const {
  processRetryBatch: processRetryBatchActivity,
} = wf.proxyActivities<ProcessRetryBatchActivityType>({
  startToCloseTimeout: '96h',
  heartbeatTimeout: '2m',
  retry: {
    maximumAttempts: 3,
    initialInterval: '10s',
    backoffCoefficient: 2.0,
    nonRetryableErrorTypes: ['ApplicationFailure', 'FatalError']
  }
});


const retryScanActionSignal = wf.defineSignal<[JobRunStatus]>('retryScanActionSignal');
const childWorkflowDoneSignal = wf.defineSignal<[string, any]>('childWorkflowDone');
const childWorkflowFailedSignal = wf.defineSignal<[string, string]>('childWorkflowFailed');

/**
 * ChildRetryScanWorkflow - Handles batch processing of failed operations for retry.
 *
 * This workflow follows a similar pattern to ChildScanWorkflow with parallel processing:
 * 1. Fetches failed operations in batches (4000 ops) from the jobs-service API
 * 2. Groups operations by parent directory and stores in Redis as opsBatches
 * 3. Processes opsBatches in parallel (workerConcurrency from getWorkerScanConfig, same as migration scan)
 * 4. For each opsBatch, generates commands for specific failed files only (no full rescan)
 * 5. Discovered subdirectories are batched and processed in parallel
 * 6. Uses cursor-based pagination with Redis checkpoint for resumability
 * 7. Supports continueAsNew for long-running retries
 */
export const ChildRetryScanWorkflow = async ({
                                               jobRunId,
                                               originalJobRunId,
                                               actionState = JobRunStatus.Running,
                                               opsBatchIds = [],
                                               batchDirs = [],
                                               batchSize = DEFAULT_BATCH_SIZE,
                                               workerConcurrency = 10,
                                               settings: inputSettings,
                                               parentWorkflowId
                                             }: ChildRetryScanWorkflowInput): Promise<ChildRetryScanWorkflowOutput> => {

  const sourceJobRunId = originalJobRunId;
  let settings: RetryScanSettings | undefined = inputSettings;

  await updateJobStatusActivity({ jobRunId, status: JobRunStatus.Running });
  await resolveUsernamesToSidsActivity(jobRunId);

  const retryScanWorkflowOutput: ChildRetryScanWorkflowOutput = {
    jobRunId,
    status: JobRunStatus.Running,
    error: undefined,
  };

  wf.setHandler(retryScanActionSignal, async (action: JobRunStatus) => {
    actionState = action;
    console.log(jobRunId, `retry scan action signal called with value: ${action}`);
  });

  let isStopRequested = false;
  let errors: string[] = [];
  let iterations = 0;
  let hasMoreToFetch = true;
  let hasMoreTasks = true;
  let shouldContinueAsNew = false;
  let fatalError: any = null;

  try {
    while (hasMoreTasks) {

      if (actionState === JobRunStatus.Stopped) {
        isStopRequested = true;
        console.log(`Stopping ChildRetryScanWorkflow ${jobRunId} as requested. ${actionState}`);
        break;
      }

      await updateJobStatusIfNotRunning(actionState, jobRunId);
      await wf.condition(() => actionState !== JobRunStatus.Paused);

      if (hasMoreToFetch) {
        try {
          const fetchResult: FetchFailedOperationsOutput = await fetchFailedOperationsActivity({
            jobRunId,
            originalJobRunId: sourceJobRunId
          });

          if (!settings) {
            settings = fetchResult.settings;
          }

          opsBatchIds.push(...fetchResult.opsBatchIds);
          hasMoreToFetch = fetchResult.hasMore;
          iterations++;

          console.log(`Fetched ${fetchResult.opsBatchIds.length} ops batches, hasMoreToFetch: ${hasMoreToFetch}`);
        } catch (error) {
          console.error(`[ERROR] Error in fetchFailedOperationsActivity: ${error.message}`);
          errors.push(error.message);
          hasMoreToFetch = false;
          throw error;
        }
      }

      const currentOpsBatchIds = [...opsBatchIds];
      const currentBatchDirs = [...batchDirs];
      opsBatchIds = [];
      batchDirs = [];

      if (currentOpsBatchIds.length > 0 || currentBatchDirs.length > 0) {
        let streamValidationSteps = 0;
        try {
          streamValidationSteps = await validateCommandStreamLength(jobRunId, () => actionState);
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.log(`[ERROR] Error validating stream length for jobRunId ${jobRunId}: ${errorMessage}`);
          throw error;
        }

        const batchExecResults = await executeRetryBatches({
          jobRunId,
          opsBatchIds: currentOpsBatchIds,
          batchDirIds: currentBatchDirs,
          batchSize,
          workerConcurrency,
          settings,
        });

        batchDirs.push(...batchExecResults.batchDirs);
        const totalBatchesProcessed = currentOpsBatchIds.length + currentBatchDirs.length;
        iterations += Math.ceil(totalBatchesProcessed / workerConcurrency) + streamValidationSteps;

        if (batchExecResults.error) {
          errors.push(batchExecResults.error);
        }
      }

      hasMoreTasks = hasMoreToFetch || opsBatchIds.length > 0 || batchDirs.length > 0;

      if (iterations > ITERATIONS_LIMIT && hasMoreTasks) {
        console.warn(`ChildRetryScanWorkflow ${jobRunId} has exceeded ${ITERATIONS_LIMIT} iterations, continuing as new.`);
        shouldContinueAsNew = true;
        break;
      }
    }
  } catch (error) {
    fatalError = error;
  }

  // Handle continueAsNew (must be outside try-catch)
  if (shouldContinueAsNew) {
    await wf.continueAsNew({
      jobRunId,
      originalJobRunId: sourceJobRunId,
      actionState,
      opsBatchIds,
      batchDirs,
      batchSize,
      workerConcurrency,
      settings,
      parentWorkflowId
    });
  }

  // Handle fatal error — signal parent before throwing
  if (fatalError) {
    if (parentWorkflowId) {
      try {
        const parentHandle = getExternalWorkflowHandle(parentWorkflowId);
        await parentHandle.signal(childWorkflowFailedSignal, 'scan', fatalError?.message || 'Fatal error in retry scan workflow');
      } catch (signalErr) {
        console.error(`ChildRetryScanWorkflow ${jobRunId} failed to signal parent: ${signalErr?.message}`);
      }
    }
    throw fatalError;
  }

  // Determine final status
  if (errors.length > 0) {
    console.log(`[ERROR] ChildRetryScanWorkflow ${jobRunId} encountered errors: ${errors.join(', ')}`);
    retryScanWorkflowOutput.error = errors.join(', ');
    retryScanWorkflowOutput.status = JobRunStatus.Errored;
  } else {
    retryScanWorkflowOutput.status = isStopRequested ? JobRunStatus.Stopped : JobRunStatus.Completed;
  }

  // Signal parent with completion
  if (parentWorkflowId) {
    try {
      const parentHandle = getExternalWorkflowHandle(parentWorkflowId);
      await parentHandle.signal(childWorkflowDoneSignal, 'scan', retryScanWorkflowOutput);
    } catch (signalErr) {
      console.error(`ChildRetryScanWorkflow ${jobRunId} failed to signal parent completion: ${signalErr?.message}`);
    }
  }

  return retryScanWorkflowOutput;
};

/**
 * Input for executeRetryBatches helper
 */
interface ExecuteRetryBatchesInput {
  jobRunId: string;
  opsBatchIds: string[];    // Batch IDs for grouped operations (process specific files)
  batchDirIds: string[];    // Batch IDs for directory scans (full readdir)
  batchSize: number;
  workerConcurrency: number;
  settings: RetryScanSettings; // Cached settings to pass to activities
}

/**
 * Output from executeRetryBatches helper
 */
interface ExecuteRetryBatchesOutput {
  batchDirs: string[];      // Newly discovered subdirectory batch IDs
  error?: string;
}

/**
 * Executes retry batches in parallel, similar to executeBatchScan in scan workflow.
 * Processes both opsBatches (specific file processing) and batchDirs (full directory scan)
 * in parallel with workerConcurrency limit (same as migration ChildScanWorkflow).
 */
export const executeRetryBatches = async ({
                                            jobRunId,
                                            opsBatchIds,
                                            batchDirIds,
                                            batchSize,
                                            workerConcurrency,
                                            settings
                                          }: ExecuteRetryBatchesInput): Promise<ExecuteRetryBatchesOutput> => {
  const output: ExecuteRetryBatchesOutput = {
    batchDirs: [],
    error: undefined,
  };

  // Combine all batch IDs with their type for processing
  const allBatches: Array<{ id: string; type: 'ops' | 'dir' }> = [
    ...opsBatchIds.map(id => ({ id, type: 'ops' as const })),
    ...batchDirIds.map(id => ({ id, type: 'dir' as const }))
  ];

  for (let i = 0; i < allBatches.length; i += workerConcurrency) {
    const batchSlice = allBatches.slice(i, i + workerConcurrency);

    const batchResults = await Promise.all(
      batchSlice.map(async (batch) => {
        try {
          const result: ProcessRetryBatchOutput = await processRetryBatchActivity({
            jobRunId,
            batchId: batch.id,
            type: batch.type,
            batchSize,
            settings
          });
          return result;
        } catch (error) {
          console.log(`[ERROR] Error processing retry batch ${batch.id}: ${error.message}`);
          throw error;
        }
      })
    );

    // Collect all batchDirs from results
    for (const result of batchResults) {
      output.batchDirs.push(...result.batchDirs);
    }
  }

  return output;
};
