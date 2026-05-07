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
export const childWorkflowDoneSignal = wf.defineSignal<[string, any]>('childWorkflowDone');
export const childWorkflowFailedSignal = wf.defineSignal<[string, string]>('childWorkflowFailed');

interface RetryMigrationWorkflowExecutorInput {
  jobRunId: string;
  originalJobRunId: string;
}

interface RetryMigrationWorkflowExecutorOutput {
  status: JobRunStatus;
  retryScanJobStatus: JobRunStatus;
  syncJobStatus: JobRunStatus;
}


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

  let scanDone = false;
  let scanOutput: any = null;
  let syncDone = false;
  let syncOutput: any = null;
  let childFailed = false;
  let failedChild = '';
  let failErrorMessage = '';
  let isStopped = false;

  wf.setHandler(childWorkflowDoneSignal, (workflowType: string, result: any) => {
    if (workflowType === 'scan') { scanDone = true; scanOutput = result; }
    if (workflowType === 'sync') { syncDone = true; syncOutput = result; }
  });

  wf.setHandler(childWorkflowFailedSignal, (workflowType: string, errorMessage: string) => {
    childFailed = true;
    failedChild = workflowType;
    failErrorMessage = errorMessage;
  });

  wf.setHandler(actionSignal, async (action: string) => {  
    if (action === JobRunStatus.Stopped) {
      retryScanWorkflow && await cancelWorkflowIfRunning(retryScanWorkflow.workflowId);
      syncWorkflow && await cancelWorkflowIfRunning(syncWorkflow.workflowId);
      output.status = JobRunStatus.Stopped;
      output.retryScanJobStatus = JobRunStatus.Stopped;
      output.syncJobStatus = JobRunStatus.Stopped;
      isStopped = true;
      return;
    }
    await signalIfRunning(retryScanWorkflow, 'retryScanActionSignal', action);
    await signalIfRunning(syncWorkflow, 'syncActionSignal', action);
  });

  const parentWorkflowId = `RetryMigrationWorkflow-${jobRunId}`;

  if (output.status !== JobRunStatus.Stopped) {
    const { concurrency: workerConcurrency, batchSize } = await getWorkerScanConfigActivity();

    retryScanWorkflow = await wf.startChild('ChildRetryScanWorkflow', {
      args: [{ jobRunId, originalJobRunId, workerConcurrency, batchSize, parentWorkflowId }],
      workflowId: `RetryScanWorkflow-${jobRunId}`,
      taskQueue: `${jobRunId}-TaskQueue`,
      cancellationType: wf.ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
      parentClosePolicy: wf.ParentClosePolicy.TERMINATE,
    });

    syncWorkflow = await wf.startChild('ChildSyncWorkflow', {
      args: [{ jobRunId: jobRunId, scanWorkflowStatus: JobRunStatus.Running, parentWorkflowId }],
      workflowId: `RetrySyncWorkflow-${jobRunId}`,
      taskQueue: `${jobRunId}-TaskQueue`,
      cancellationType: wf.ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
      parentClosePolicy: wf.ParentClosePolicy.TERMINATE,
    });

    // Phase 1: Wait for retry scan to complete OR any child to fail
    await wf.condition(() => scanDone || childFailed || isStopped);

    if (isStopped) {
      // Handled by actionSignal handler above
    } else if (childFailed) {
      await cancelWorkflowIfRunning(retryScanWorkflow.workflowId);
      await cancelWorkflowIfRunning(syncWorkflow.workflowId);
      output.retryScanJobStatus = failedChild === 'scan' ? JobRunStatus.Failed : JobRunStatus.Stopped;
      output.syncJobStatus = failedChild === 'sync' ? JobRunStatus.Failed : JobRunStatus.Stopped;

      await updateWorkerResponseActivity(jobRunId, 'all', {
        status: JobRunStatus.Failed,
        code: 'RETRY_SYNC_FAILURE',
        operation: 'Child Workflow Failed',
        occurrence: 1,
        origin: failedChild === 'sync' ? 'ChildSyncWorkflow' : 'ChildRetryScanWorkflow',
        message: `Child workflow failed with error: ${failErrorMessage}`,
        createdAt: new Date()
      });
    } else {
      // Retry scan completed — signal sync so it knows to drain and exit
      output.retryScanJobStatus = scanOutput.status;
      await signalIfRunning(syncWorkflow, 'scanResultSignal', output.retryScanJobStatus);

      // Phase 2: Wait for sync to complete OR fail
      await wf.condition(() => syncDone || childFailed || isStopped);

      if (isStopped) {
        // Handled by actionSignal handler above
      } else if (childFailed) {
        await cancelWorkflowIfRunning(retryScanWorkflow.workflowId);
        await cancelWorkflowIfRunning(syncWorkflow.workflowId);
        output.syncJobStatus = JobRunStatus.Failed;

        await updateWorkerResponseActivity(jobRunId, 'all', {
          status: JobRunStatus.Failed,
          code: 'RETRY_SYNC_FAILURE',
          operation: 'Sync Workflow Failed',
          occurrence: 1,
          origin: 'ChildSyncWorkflow',
          message: `Child workflow failed with error: ${failErrorMessage}`,
          createdAt: new Date()
        });
      } else {
        output.syncJobStatus = syncOutput.status;
      }
    }
  }

  output.status = getUnifiedJobStatus(output.retryScanJobStatus, output.syncJobStatus);

  await updateLastEntryActivity(jobRunId);
  return output;
};

