import * as wf from '@temporalio/workflow';
import { ChildWorkflowCancellationType, ParentClosePolicy } from "@temporalio/workflow";
import { CommonActivityService } from 'src/activities/common/common.service';
import { MigrationTaskService } from "src/activities/migrate/migrate.taskmanager.service";
import { CutOverStatus } from "src/activities/migrate/migrate.type";
import { ReportingWorkflow } from "src/workflows/reporting/reporting.workflow";
import { CleanupWorkerWorkflow } from "src/workflows/workflows";

interface WorkerConfig {
  ids: string[];
}  

interface CutOverWorkFlowInput {
  traceId: string;
  payload: {
    workers: string[];
  };
  options?: Record<string, any>; 
}

export const registerNewWorkerSignal = wf.defineSignal<[WorkerConfig]>('registerNewWorker');
export const unblockSignal =  wf.defineSignal<[string]>('approve');
export const reportingSignal =  wf.defineSignal<[string]>('reportingSignal');
export const isBlockedQuery = wf.defineQuery<boolean>('isBlocked');


const {
  updateCutOverStatus: updateCutOverStatusActivity
} = wf.proxyActivities<MigrationTaskService>({ startToCloseTimeout: '5h' });


const {
   updateJobErrorStatus: updateJobErrorActivity,
   getJobState: getJobStateActivity,
} = wf.proxyActivities<CommonActivityService>({ startToCloseTimeout: '5h' });


export const CutOverWorkFlow = async ({
  traceId,
  payload,
  options = {},
}: CutOverWorkFlowInput): Promise<any> => {
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
  if(!errored) {
    console.debug(`Waiting For approval workflow JobRun Id: ${traceId}`)
    await WaitingForApproval(traceId, unblockSignal)
  }

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
      }
    }),
    )
  }
  return {status: 'success', message: 'Cutover workflow completed successfully'};
};

export const WaitingForApproval = async (
  traceId: string,
  approve_signal: wf.SignalDefinition<[string], string>
): Promise<string> => {
  let isBlocked = true;
  let approval_status: CutOverStatus | undefined;

  wf.setHandler(isBlockedQuery, () => isBlocked);

  wf.setHandler(approve_signal, (input: string) => {
    console.error(input)
    if((input == CutOverStatus.APPROVED) || (input == CutOverStatus.REJECTED) ) {
      approval_status = input;
      isBlocked = false;
    }
  });

  wf.log.info('Waiting for approval...');

  try {
    await wf.condition(() => !isBlocked);
    await updateCutOverStatusActivity({jobRunId: traceId,  status: approval_status })
    wf.log.info(`Cutover approval received: ${approval_status}`);
    console.error(`Cutover approval received: ${approval_status}`);

  } catch (err) {
    if (err instanceof wf.CancelledFailure) {
      wf.log.info('Workflow cancelled');
    }
    throw err;
  }
  return approval_status ?? 'No approval received';
};