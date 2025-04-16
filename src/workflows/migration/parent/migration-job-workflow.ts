import * as wf from '@temporalio/workflow';
import { ChildWorkflowCancellationType, ParentClosePolicy } from "@temporalio/workflow";
import { CommonActivityService } from "src/activities/common/common.service";
import { ReportingWorkflow } from "src/workflows/reporting/reporting.workflow";
import { CleanupWorkerWorkflow } from "src/workflows/workflows";
interface MigrationWorkflowInput {
  traceId: string;
  payload: {
    workers: string[];
  };
  options?: Record<string, any>; 
}

interface WorkerConfig {
  ids: string[];
}  

export const reportingSignal =  wf.defineSignal<[string]>('reportingSignal');
export const registerNewWorkerSignal = wf.defineSignal<[WorkerConfig]>('registerNewWorker');

const {
  getJobState: getJobStateActivity,
  updateJobErrorStatus: updateJobErrorActivity
} = wf.proxyActivities<CommonActivityService>({ startToCloseTimeout: '5h' });


export const MigrationWorkflow = async ({
  traceId,
  payload,
  options = {},
}: MigrationWorkflowInput): Promise<any> => {
  console.log(`[${traceId}] Parent workflow started for ${traceId}`);

  let setupCompletedWorkers = []
  let erroredCount = 0, newWorkerCount = 0;

  // setup on new worker signal
  wf.setHandler(registerNewWorkerSignal, async (workerConfig: WorkerConfig) => {
    const jobState = await getJobStateActivity(traceId);
    workerConfig.ids.map(async (id) => {
      // exclude already setup workers
      if(jobState.workers_agreed.includes(id)) return;
      const workerFuture = await wf.startChild('SetupWorkerWorkflow', {
        args: [ { jobRunId: traceId } ],
        workflowId: `SetupWorkerWorkflow-${traceId}-${id}`,
        taskQueue: `${id}-TaskQueue`,
        cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
        parentClosePolicy: ParentClosePolicy.TERMINATE,
        ...options,
      });
      newWorkerCount++
      const result = await workerFuture.result();
      if (result?.status === 'success') 
        setupCompletedWorkers.push(id);
      else {
        erroredCount++;
        console.error(`[${traceId}] Failed to setup worker: ${id}`);
      }
    })
  });

  payload.workers.map(async (worker) => {
    const workerFuture = await wf.startChild('SetupWorkerWorkflow', {
      args: [ { jobRunId: traceId } ],
      workflowId: `SetupWorkerWorkflow-${traceId}-${worker}`,
      taskQueue: `${worker}-TaskQueue`,
      cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
      parentClosePolicy: ParentClosePolicy.TERMINATE,
      ...options
    });
    try{
      const result = await workerFuture.result();
      if (result?.status === 'success') 
        setupCompletedWorkers.push(worker);
      else {
        erroredCount++;
        console.error(`[${traceId}] Failed to setup worker: ${worker}`);
      }
    }catch(error) {
        erroredCount++;
        console.error(`[${traceId}] Error in SetupWorkerWorkflow: ${error}`);
    }
  })

  if(erroredCount === (payload.workers.length+newWorkerCount)) {
      console.error(`Fatal error occurred for all active workers for jobRun Id: ${traceId}`)
      await updateJobErrorActivity(traceId)
  }

  await wf.condition(() => setupCompletedWorkers.length > 0);

  // scan workflow
  const scanWorkflow = await wf.startChild('ScanWorkflow', {
    args: [ { jobRunId: traceId } ],
    workflowId: `ScanWorkflow-${traceId}`,
    taskQueue: `${traceId}-TaskQueue`,
    cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
    parentClosePolicy: ParentClosePolicy.TERMINATE,
  });

  // sync workflow
  const syncWorkflow = await wf.startChild('SyncWorkflow', {
    args: [ { jobRunId: traceId } ],
    workflowId: `SyncWorkflow-${traceId}`,
    taskQueue: `${traceId}-TaskQueue`,
    cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
    parentClosePolicy: ParentClosePolicy.TERMINATE,
  });

  // wait for scan workflow to complete
  const scanWorkflowResult = await scanWorkflow.result()
  console.log(`[${traceId}] ScanWorkflow result: ${JSON.stringify(scanWorkflowResult)}`);

  await syncWorkflow.signal('isScanCompleted', {})

  const syncWorkflowResult = await syncWorkflow.result()
  console.log(`[${traceId}] SyncWorkflow result: ${JSON.stringify(syncWorkflowResult)}`);

  let jobState = await getJobStateActivity(traceId);
  let errored = jobState.failedWorkers.length === setupCompletedWorkers.length;

  if(errored) {
    console.error(`Fatal error occurred for all active workers for jobRun Id: ${traceId}`)
    await updateJobErrorActivity(traceId)
  }

  console.debug(`Generating Report JobRun Id: ${traceId}`)
  await ReportingWorkflow(traceId, reportingSignal)

  if (setupCompletedWorkers.length > 0) {
    await Promise.all(
      setupCompletedWorkers.map(async (workerId) => {
      console.log(`[${traceId}] Starting CleanupWorkerWorkflow for workerId: ${workerId}`);
      try {
          return await wf.executeChild(CleanupWorkerWorkflow, {
          args: [{ jobRunId: traceId }],
          workflowId: `CleanupWorkerWorkflow-${traceId}`,
          taskQueue: `${workerId}-TaskQueue`,
          ...options,
          cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
          parentClosePolicy: ParentClosePolicy.TERMINATE,
          });
      } catch (error) {
          console.error(`[${traceId}] Error in CleanupWorkerWorkflow: ${error}`);
          throw error;
      }
    }),
    )
  }
  return {result : 'Completed', setupCompletedWorkers, erroredCount, newWorkerCount};
};
