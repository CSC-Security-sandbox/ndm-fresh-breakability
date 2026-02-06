import * as wf from '@temporalio/workflow';
import { CommonActivityService } from 'src/activities/common/common.service';
import { JobRunStatus } from 'src/activities/common/enums';
import { waitUntilRedisMemoryOk } from 'src/workflows/utils/memory-utils';
import { executeCleanup } from '../common/execute-cleanup-workflow';
import { executeRetryMigrationChildWorkflows } from '../common/execute-retry-migration-child-workflows';
import { handleReporting } from '../common/handle-reporting';
import { executeWorkerSetup } from '../common/execute-setup-workflow';

// Proxy activity for updating job run status
const {
  updateStatus: updateStatusActivity,
} = wf.proxyActivities<CommonActivityService>({
  startToCloseTimeout: '10m',
  retry: { maximumAttempts: 3, initialInterval: '30s', backoffCoefficient: 1 }
});


interface RetryMigrationWorkflowInput {
  traceId: string;
  payload: {
    workers: string[];
    jobRunId: string;  // Required - the parent job run ID to retry from
  };
  options?: Record<string, any>; 
}

interface RetryMigrationWorkflowOutput {
  traceId: string;
  setupCompletedWorkers: string[];
  failedWorkers: string[];
  status: JobRunStatus;
  jobRunId: string;
}


/**
 * RetryMigrationWorkflow - A dedicated workflow for retrying failed operations
 * 
 * This workflow is triggered when a user wants to retry only the failed items
 * from a previous job run. Instead of scanning the file system, it:
 * 1. Fetches failed operations from the parent job run
 * 2. Generates commands from those failed operations
 * 3. Executes the sync workflow to process those commands
 * 
 * Key differences from MigrationWorkflow:
 * - No file system scan
 * - Loads failed items from operation_errors table via API
 * - Uses jobRunId to identify the source of failed items
 */
export const RetryMigrationWorkflow = async ({
  traceId,
  payload,
  options = {},
}: RetryMigrationWorkflowInput): Promise<RetryMigrationWorkflowOutput> => {
    const output: RetryMigrationWorkflowOutput = {
      traceId: traceId,
      setupCompletedWorkers: [],
      failedWorkers: [],
      status: JobRunStatus.Ready,
      jobRunId: payload.jobRunId,
    };

    // Validate jobRunId is provided
    if (!payload.jobRunId) {
      output.status = JobRunStatus.Failed;
      await updateStatusActivity({ jobRunId: traceId, status: JobRunStatus.Failed });
      return output;
    }

    // Setup workers
    const setupWorkersExecResult = await executeWorkerSetup({
      jobRunId: traceId, 
      workerIds: payload.workers, 
      options
    });
    output.setupCompletedWorkers = setupWorkersExecResult.setupCompletedWorkers;
    output.failedWorkers = setupWorkersExecResult.failedWorkers;

    // Validate Redis memory before proceeding
    await waitUntilRedisMemoryOk(traceId);

    // Execute retry migration workflow (loads failed items and syncs)
    // traceId = new job run ID for workflow IDs and task queues
    // payload.jobRunId = original job run ID to fetch failed operations from
    const retryWorkflowExecResult = await executeRetryMigrationChildWorkflows({
      jobRunId: traceId,
      originalJobRunId: payload.jobRunId,
    });
    output.status = retryWorkflowExecResult.status;

    // Reporting and Report Generation (this also updates final status)
    await handleReporting(traceId, output.status);

    // Cleanup
    await executeCleanup({ 
      jobRunId: traceId, 
      workerIds: output.setupCompletedWorkers, 
      options 
    });

    return output;
}
