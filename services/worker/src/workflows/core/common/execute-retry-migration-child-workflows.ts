import * as wf from '@temporalio/workflow';
import { CommonActivityService } from 'src/activities/common/common.service';
import { CommonTaskService } from 'src/activities/core/common/common-task.service';
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

const {
  getWorkerScanConfig: getWorkerScanConfigActivity,
} = wf.proxyActivities<CommonTaskService>({
  startToCloseTimeout: '1m',
  retry: { maximumAttempts: 3, initialInterval: '10s', backoffCoefficient: 1 },
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
  let stopRequested = false;
  
  let output: RetryMigrationWorkflowExecutorOutput = {
    status: JobRunStatus.Running,
    retryScanJobStatus: JobRunStatus.Running,
    syncJobStatus: JobRunStatus.Running,
  };

  // Handle stop/pause signals (uses 'action' signal name to match jobs-service)
  wf.setHandler(actionSignal, async (action: string) => {  
    if (action === JobRunStatus.Stopped) {
      stopRequested = true;
      retryScanWorkflow && await cancelWorkflowIfRunning(retryScanWorkflow.workflowId);
      await signalIfRunning(syncWorkflow, 'syncActionSignal', JobRunStatus.Stopped);
      output.retryScanJobStatus = JobRunStatus.Stopped;
      return;
    }
    await signalIfRunning(retryScanWorkflow, 'retryScanActionSignal', action);
    await signalIfRunning(syncWorkflow, 'syncActionSignal', action);
  });

  if (!stopRequested) {
    const { concurrency: workerConcurrency, batchSize } = await getWorkerScanConfigActivity();
    
    retryScanWorkflow = await wf.startChild('ChildRetryScanWorkflow', {
      args: [{ jobRunId, originalJobRunId, workerConcurrency, batchSize }],
      workflowId: `RetryScanWorkflow-${jobRunId}`,
      taskQueue: `${jobRunId}-TaskQueue`,
      cancellationType: wf.ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
      parentClosePolicy: wf.ParentClosePolicy.TERMINATE,
    });

    syncWorkflow = await wf.startChild('ChildSyncWorkflow', {
      args: [{ jobRunId: jobRunId, scanWorkflowStatus: JobRunStatus.Running, actionState: JobRunStatus.Running }],
      workflowId: `RetrySyncWorkflow-${jobRunId}`,
      taskQueue: `${jobRunId}-TaskQueue`,
      cancellationType: wf.ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
      parentClosePolicy: wf.ParentClosePolicy.TERMINATE,
    });

    let failErrorMessage = '';
    let failOrigin = '';
    let failOperation = '';
    let failCode = '';

    const handleError = async (
      error: any,
      siblingWorkflowId: string,
      origin: string,
      operation: string,
      code: string,
    ): Promise<JobRunStatus> => {
      if (wf.isCancellation(error) || wf.isCancellation(error?.cause)) {
        return JobRunStatus.Stopped;
      }
      failErrorMessage = error?.message || 'Unknown error';
      failOrigin = origin;
      failOperation = operation;
      failCode = code;
      await cancelWorkflowIfRunning(siblingWorkflowId);
      return JobRunStatus.Failed;
    };

    const scanPromise = retryScanWorkflow.result()
      .then(async (retryScanWorkflowOutput) => {
        output.retryScanJobStatus = retryScanWorkflowOutput.status;
        await signalIfRunning(syncWorkflow, 'scanResultSignal', output.retryScanJobStatus);
      })
      .catch(async (error) => {
        output.retryScanJobStatus = await handleError(error, syncWorkflow.workflowId, 'RetryMigrationWorkflow', 'Retry Scan Workflow Failed', 'RETRY_SCAN_FAILURE');
      });

    const syncPromise = syncWorkflow.result()
      .then(async (syncWorkflowOutput) => {
        output.syncJobStatus = syncWorkflowOutput.status;
      })
      .catch(async (error) => {
        output.syncJobStatus = await handleError(error, retryScanWorkflow.workflowId, 'RetryMigrationWorkflow', 'Retry Sync Workflow Failed', 'RETRY_SYNC_FAILURE');
      });

    await Promise.all([scanPromise, syncPromise]);

    if (failErrorMessage) {
      await updateWorkerResponseActivity(jobRunId, 'all', {
        status: JobRunStatus.Failed,
        code: failCode,
        operation: failOperation,
        occurrence: 1,
        origin: failOrigin,
        message: `${failOperation} with error: ${failErrorMessage}`,
        createdAt: new Date()
      });
    }
  } else {
    output.syncJobStatus = JobRunStatus.Stopped;
  }

  // Determine final status
  output.status = getUnifiedJobStatus(output.retryScanJobStatus, output.syncJobStatus);

  await updateLastEntryActivity(jobRunId);
  return output;
};
