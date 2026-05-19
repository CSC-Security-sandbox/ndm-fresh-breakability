import * as wf from '@temporalio/workflow';
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
                                               settings: inputSettings
                                             }: ChildRetryScanWorkflowInput): Promise<ChildRetryScanWorkflowOutput> => {

  // Use originalJobRunId to fetch failed operations, default to jobRunId if not provided
  const sourceJobRunId = originalJobRunId;
  
  // Settings will be populated on first fetch and reused for all subsequent activities
  let settings: RetryScanSettings | undefined = inputSettings;

  // Update status to RUNNING at start
  await updateJobStatusActivity({ jobRunId, status: JobRunStatus.Running });

  await resolveUsernamesToSidsActivity(jobRunId);

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
  let hasMoreToFetch = true;  // Tracks if API has more pages
  let hasMoreTasks = true;    // Tracks all pending work (API + batches + dirs)

  // Main processing loop - continues while there are tasks to process
  while (hasMoreTasks) {

    // Handle stop request
    if (actionState === JobRunStatus.Stopped) {
      isStopRequested = true;
      console.log(`Stopping ChildRetryScanWorkflow ${jobRunId} as requested. ${actionState}`);
      break;
    }

    // Wait if paused
    await updateJobStatusIfNotRunning(actionState, jobRunId);
    await wf.condition(() => actionState !== JobRunStatus.Paused);

    // PHASE 1: Fetch more failed operations if available
    if (hasMoreToFetch) {
      try {
        const fetchResult: FetchFailedOperationsOutput = await fetchFailedOperationsActivity({
          jobRunId,
          originalJobRunId: sourceJobRunId
        });

        // Capture settings from first fetch (will be same for all subsequent fetches)
        if (!settings) {
          settings = fetchResult.settings;
        }

        // Add new opsBatchIds to the queue
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

    // PHASE 2: Process opsBatches and batchDirs in parallel
    // Snapshot current batches and clear queues for new discoveries
    const currentOpsBatchIds = [...opsBatchIds];
    const currentBatchDirs = [...batchDirs];
    opsBatchIds = [];
    batchDirs = [];

    if (currentOpsBatchIds.length > 0 || currentBatchDirs.length > 0) {
      // Validate command stream length before processing (steps counted toward continueAsNew)
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

      // Collect newly discovered subdirectory batches
      batchDirs.push(...batchExecResults.batchDirs);
      const totalBatchesProcessed = currentOpsBatchIds.length + currentBatchDirs.length;
      iterations += Math.ceil(totalBatchesProcessed / workerConcurrency) + streamValidationSteps;

      if (batchExecResults.error) {
        errors.push(batchExecResults.error);
      }
    }

    // Update hasMoreTasks: more to fetch OR pending batches OR discovered dirs
    hasMoreTasks = hasMoreToFetch || opsBatchIds.length > 0 || batchDirs.length > 0;

    // Check iteration limit for continueAsNew
    if (iterations > ITERATIONS_LIMIT && hasMoreTasks) {
      console.warn(`ChildRetryScanWorkflow ${jobRunId} has exceeded ${ITERATIONS_LIMIT} iterations, continuing as new.`);
      await wf.continueAsNew({
        jobRunId,
        originalJobRunId: sourceJobRunId,
        actionState,
        opsBatchIds,
        batchDirs,
        batchSize,
        workerConcurrency,
        settings
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
