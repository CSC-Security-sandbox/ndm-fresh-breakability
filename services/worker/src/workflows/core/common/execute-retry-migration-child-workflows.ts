import * as wf from '@temporalio/workflow';
import { CommonActivityService } from 'src/activities/common/common.service';
import { JobRunStatus } from "src/activities/common/enums";
import { cancelWorkflowIfRunning, getUnifiedJobStatus, signalIfRunning } from './workflow-utils';


const {
  updateLastEntry: updateLastEntryActivity,
} = wf.proxyActivities<CommonActivityService>({
  startToCloseTimeout: '30m',
  retry: { maximumAttempts: 3, initialInterval: '30s', backoffCoefficient: 1 }
});


const { 
  updateWorkerResponse: updateWorkerResponseActivity 
} = wf.proxyActivities<CommonActivityService>({ 
  startToCloseTimeout: '10m', 
  retry: { maximumAttempts: 3, initialInterval: '30s', backoffCoefficient: 1 } 
});

// Use 'action' signal name to match jobs-service signal (same as migration workflow)
export const actionSignal = wf.defineSignal<[string]>('action');

interface RetryMigrationWorkflowExecutorInput {
  jobRunId: string;           // New retry job run ID (for workflow IDs and task queues)
  originalJobRunId: string;   // Original job run ID (to fetch failed operations from)
}

interface RetryMigrationWorkflowExecutorOutput {
  status: JobRunStatus;
  retryScanJobStatus: JobRunStatus;
  syncJobStatus: JobRunStatus;
}


/**
 * Executes the retry migration child workflows
 * 
 * Flow (mirrors normal migration workflow):
 * 1. Start ChildRetryScanWorkflow and ChildSyncWorkflow in parallel
 * 2. ChildRetryScanWorkflow fetches failed operations in batches and publishes to Redis stream
 * 3. ChildSyncWorkflow processes commands from the stream (same as normal migration)
 * 4. Wait for both workflows to complete
 * 
 * This architecture matches the normal migration flow:
 * - ChildRetryScanWorkflow plays the role of ChildScanWorkflow
 * - Uses cursor-based pagination with Redis checkpoint for resumability
 * - No file system access - commands are created directly from failed operation records
 */
export const executeRetryMigrationChildWorkflows = async ({
  jobRunId,
  originalJobRunId
}: RetryMigrationWorkflowExecutorInput): Promise<RetryMigrationWorkflowExecutorOutput> => {

  let retryScanWorkflow: wf.ChildWorkflowHandle<wf.Workflow>;
  let syncWorkflow: wf.ChildWorkflowHandle<wf.Workflow>;
  
  let output: RetryMigrationWorkflowExecutorOutput = {
    status: JobRunStatus.Running,
    retryScanJobStatus: JobRunStatus.Running,
    syncJobStatus: JobRunStatus.Running,
  };

  // Handle stop/pause signals (uses 'action' signal name to match jobs-service)
  wf.setHandler(actionSignal, async (action: string) => {  
    if (action === JobRunStatus.Stopped) {
      retryScanWorkflow && await cancelWorkflowIfRunning(retryScanWorkflow.workflowId);
      syncWorkflow && await cancelWorkflowIfRunning(syncWorkflow.workflowId);
      output.status = JobRunStatus.Stopped;
      output.retryScanJobStatus = JobRunStatus.Stopped;
      output.syncJobStatus = JobRunStatus.Stopped;
      return;
    }
    await signalIfRunning(retryScanWorkflow, 'retryScanActionSignal', action);
    await signalIfRunning(syncWorkflow, 'syncActionSignal', action);
  });

  if (output.status !== JobRunStatus.Stopped) {
    // Start ChildRetryScanWorkflow - fetches failed operations and publishes to stream
    // Uses originalJobRunId to fetch failed operations, but jobRunId for workflow/task identifiers
    retryScanWorkflow = await wf.startChild('ChildRetryScanWorkflow', {
      args: [{ jobRunId: jobRunId, originalJobRunId: originalJobRunId }],
      workflowId: `RetryScanWorkflow-${jobRunId}`,
      taskQueue: `${jobRunId}-TaskQueue`,
      cancellationType: wf.ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
      parentClosePolicy: wf.ParentClosePolicy.TERMINATE,
    });

    // Start ChildSyncWorkflow in parallel - processes commands from stream
    syncWorkflow = await wf.startChild('ChildSyncWorkflow', {
      args: [{ jobRunId: jobRunId, scanWorkflowStatus: JobRunStatus.Running }],
      workflowId: `RetrySyncWorkflow-${jobRunId}`,
      taskQueue: `${jobRunId}-TaskQueue`,
      cancellationType: wf.ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
      parentClosePolicy: wf.ParentClosePolicy.TERMINATE,
    });

    let scanDone = false;
    let scanOutput: any = null;
    let scanFailed = false;
    let syncDone = false;
    let syncOutput: any = null;
    let syncFailed = false;
    let failError: any = null;

    retryScanWorkflow.result()
      .then((result) => { scanDone = true; scanOutput = result; })
      .catch((err) => { scanFailed = true; failError = failError || err; });

    syncWorkflow.result()
      .then((result) => { syncDone = true; syncOutput = result; })
      .catch((err) => { syncFailed = true; failError = failError || err; });

    // Phase 1: Wait for retry scan to complete OR either child to fail
    await wf.condition(() => scanDone || scanFailed || syncFailed);

    if (syncFailed || scanFailed) {
      await cancelWorkflowIfRunning(retryScanWorkflow.workflowId);
      await cancelWorkflowIfRunning(syncWorkflow.workflowId);

      if (failError && wf.isCancellation(failError.cause)) {
        output.retryScanJobStatus = JobRunStatus.Stopped;
        output.syncJobStatus = JobRunStatus.Stopped;
      } else {
        output.retryScanJobStatus = JobRunStatus.Failed;
        output.syncJobStatus = JobRunStatus.Failed;
      }

      await updateWorkerResponseActivity(jobRunId, 'all', {
        status: output.syncJobStatus,
        code: 'RETRY_SYNC_FAILURE',
        operation: 'Child Workflow Failed',
        occurrence: 1,
        origin: syncFailed ? 'ChildSyncWorkflow' : 'ChildRetryScanWorkflow',
        message: `Child workflow failed with error: ${failError?.message || 'Unknown error'}`,
        createdAt: new Date()
      });
    } else {
      // Retry scan completed — signal sync so it knows to drain and exit
      await signalIfRunning(syncWorkflow, 'scanResultSignal', scanOutput.status);

      // Phase 2: Wait for sync to complete OR fail
      await wf.condition(() => syncDone || syncFailed);

      if (syncFailed) {
        await cancelWorkflowIfRunning(retryScanWorkflow.workflowId);
        await cancelWorkflowIfRunning(syncWorkflow.workflowId);

        if (failError && wf.isCancellation(failError.cause)) {
          output.retryScanJobStatus = JobRunStatus.Stopped;
          output.syncJobStatus = JobRunStatus.Stopped;
        } else {
          output.syncJobStatus = JobRunStatus.Failed;
        }

        await updateWorkerResponseActivity(jobRunId, 'all', {
          status: JobRunStatus.Failed,
          code: 'RETRY_SYNC_FAILURE',
          operation: 'Sync Workflow Failed',
          occurrence: 1,
          origin: 'ChildSyncWorkflow',
          message: `Child workflow failed with error: ${failError?.message || 'Unknown error'}`,
          createdAt: new Date()
        });
      } else {
        // Both completed successfully
        output.retryScanJobStatus = scanOutput.status;
        output.syncJobStatus = syncOutput.status;
      }
    }
  }

  // Determine final status
  output.status = getUnifiedJobStatus(output.retryScanJobStatus, output.syncJobStatus);

  await updateLastEntryActivity(jobRunId);
  return output;
};

