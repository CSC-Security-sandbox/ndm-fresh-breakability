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

    // Signal sync when retry scan finishes so sync knows to drain remaining tasks and exit
    retryScanWorkflow.result().then(
      (scanResult) => signalIfRunning(syncWorkflow, 'scanResultSignal', scanResult.status),
      () => signalIfRunning(syncWorkflow, 'scanResultSignal', JobRunStatus.Failed)
    );

    // Await both — Promise.all rejects immediately if either child fails
    try {
      const [retryScanWorkflowOutput, syncWorkflowOutput] = await Promise.all([
        retryScanWorkflow.result(),
        syncWorkflow.result()
      ]);
      output.retryScanJobStatus = retryScanWorkflowOutput.status;
      output.syncJobStatus = syncWorkflowOutput.status;
    } catch (error) {
      await cancelWorkflowIfRunning(retryScanWorkflow.workflowId);
      await cancelWorkflowIfRunning(syncWorkflow.workflowId);

      if (wf.isCancellation(error.cause)) {
        output.retryScanJobStatus = JobRunStatus.Stopped;
        output.syncJobStatus = JobRunStatus.Stopped;
      } else {
        output.retryScanJobStatus = JobRunStatus.Failed;
        output.syncJobStatus = JobRunStatus.Failed;
      }

      await updateWorkerResponseActivity(jobRunId, 'all', {
        status: output.syncJobStatus,
        code: 'RETRY_SYNC_FAILURE',
        operation: 'Retry Sync Workflow',
        occurrence: 1,
        origin: 'RetryMigrationWorkflow',
        message: `Child workflow failed with error: ${error.message}`,
        createdAt: new Date()
      });
    }
  }

  // Determine final status
  output.status = getUnifiedJobStatus(output.retryScanJobStatus, output.syncJobStatus);

  await updateLastEntryActivity(jobRunId);
  return output;
};

