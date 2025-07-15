import * as wf from '@temporalio/workflow';
import { ChildWorkflowCancellationType, ParentClosePolicy } from "@temporalio/workflow";
import { CommonActivityService } from '../../../activities/common/common.service';
import { JobRunStatus } from '../../../activities/discovery/enums';
import { MigrationTaskService } from "../../../activities/migrate/migrate.taskmanager.service";
import { CutOverStatus } from "../../../activities/migrate/migrate.type";
import { ReportingWorkflow } from "../../../workflows/reporting/reporting.workflow";
import { waitUntilRedisMemoryOk } from '../../../workflows/utils/memory-utils';
import { CleanupWorkerWorkflow } from "../../../workflows/workflows";

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

interface CutOverWorkflowOutput {
  traceId: string;
  setupCompletedWorkers:string[];
  failedWorkers:string[];
  setupFailedWorkerCount: number;
  newAddedWorkerCount: number;
  isScanIsRunning: boolean;
  isSyncIsRunning: boolean; 
  isJobFailed: boolean;
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
   updateWorkerResponse: updateWorkerResponse,
   cleanupJobContext: cleanupJobContextActivity,
} = wf.proxyActivities<CommonActivityService>({ startToCloseTimeout: '5h' });

export const CutOverWorkFlow = async ({
  traceId,
  payload,
  options = {},
}: CutOverWorkFlowInput): Promise<any> => {
  console.log(`[${traceId}] Parent workflow started for ${traceId}`);

  const workFlowStatus: CutOverWorkflowOutput = {
    failedWorkers: [],
    setupCompletedWorkers: [],
    setupFailedWorkerCount: 0,
    newAddedWorkerCount: 0, 
    isScanIsRunning: false,
    isSyncIsRunning: false,
    isJobFailed: false,
    traceId: traceId,    
  }
  let scanWorkflow: wf.ChildWorkflowHandle<wf.Workflow>;
  let syncWorkflow: wf.ChildWorkflowHandle<wf.Workflow>;

  // setup on new worker signal
  wf.setHandler(registerNewWorkerSignal, async (workerConfig: WorkerConfig) => {
    workerConfig.ids.map(async (id) => {
      // exclude already setup workers
      if(workFlowStatus.setupCompletedWorkers.includes(id)) return;
      const workerFuture = await wf.startChild('SetupWorkerWorkflow', {
        args: [ { jobRunId: traceId } ],
        workflowId: `SetupWorkerWorkflow-${traceId}-${id}`,
        taskQueue: `${id}-TaskQueue`,
        cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
        parentClosePolicy: ParentClosePolicy.TERMINATE,
        ...options,
      });
      workFlowStatus.newAddedWorkerCount++
      const result = await workerFuture.result();
      if (result?.status === 'success') {
        workFlowStatus.setupCompletedWorkers.push(id);
        if(workFlowStatus.isScanIsRunning) 
          await scanWorkflow.signal('syncWorkerList', workFlowStatus.setupCompletedWorkers);
        if(workFlowStatus.isSyncIsRunning) 
          await syncWorkflow.signal('syncWorkerList', workFlowStatus.setupCompletedWorkers);
      }
      else {
        workFlowStatus.setupFailedWorkerCount++;
        await updateWorkerResponse(traceId, id, {
          status: 'FAILED',
          code: 'SETUP_WORKER_FAILURE',
          operation: 'Worker Setup Failed',
          occurrence: 1,
          origin: 'Worker',
          message: result.message,
          createdAt: new Date()
        });
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
      if (result?.status === 'success') {
        workFlowStatus.setupCompletedWorkers.push(worker);
        if(workFlowStatus.isScanIsRunning)
          await scanWorkflow.signal('syncWorkerList', workFlowStatus.setupCompletedWorkers);
        if(workFlowStatus.isSyncIsRunning) 
          await syncWorkflow.signal('syncWorkerList', workFlowStatus.setupCompletedWorkers);
      }
      else {
        workFlowStatus.setupFailedWorkerCount++;
        await updateWorkerResponse(traceId, worker, {
          status: 'FAILED',
          code: 'SETUP_WORKER_FAILURE',
          operation: 'Worker Setup Failed',
          occurrence: 1,
          origin: 'Worker',
          message: result.message,
          createdAt: new Date()
        });
        console.error(`[${traceId}] Failed to setup worker: ${worker}`);
      }
    }catch(error) {
      workFlowStatus.setupFailedWorkerCount++;
      await updateWorkerResponse(traceId, worker, { 
        status: 'FAILED',
        code: 'SETUP_WORKER_FAILURE',
        operation: 'Worker Setup Failed',
        occurrence: 1,
        origin: 'Worker',
        message: error.message,
        createdAt: new Date() });
      console.error(`[${traceId}] Error in SetupWorkerWorkflow: ${error}`);
    }
  })

  
  await wf.condition(() => (workFlowStatus.setupCompletedWorkers.length > 0) || (workFlowStatus.setupFailedWorkerCount === (payload.workers.length+workFlowStatus.newAddedWorkerCount)));
  
  if(workFlowStatus.setupFailedWorkerCount === (payload.workers.length+workFlowStatus.newAddedWorkerCount)) {
    console.error(`Fatal error occurred for all active workers for jobRun Id: ${traceId}`)
    await updateJobErrorActivity(traceId)
  }
  // wait until redis has enough memory
  await waitUntilRedisMemoryOk(traceId);

  // scan workflow
  scanWorkflow = await wf.startChild('ScanWorkflow', {
    args: [ { jobRunId: traceId, workers:workFlowStatus.setupCompletedWorkers, failedWorkers: [] } ],
    workflowId: `ScanWorkflow-${traceId}`,
    taskQueue: `${traceId}-TaskQueue`,
    cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
    parentClosePolicy: ParentClosePolicy.TERMINATE,
  });
  workFlowStatus.isScanIsRunning = true;

  // sync workflow
  syncWorkflow = await wf.startChild('SyncWorkflow', {
    args: [ { jobRunId: traceId, workers:workFlowStatus.setupCompletedWorkers, failedWorkers: [], isScanCompleted : false} ],
    workflowId: `SyncWorkflow-${traceId}`,
    taskQueue: `${traceId}-TaskQueue`,
    cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
    parentClosePolicy: ParentClosePolicy.TERMINATE,
  });
  workFlowStatus.isSyncIsRunning = true;




  // wait for scan workflow to complete
  const scanWorkflowResult = await scanWorkflow.result()
  workFlowStatus.isScanIsRunning = false;
  if(scanWorkflowResult.status === JobRunStatus.Errored) workFlowStatus.isJobFailed = true;
  scanWorkflowResult.failedWorkers.map((workerId) => {
    if(!workFlowStatus.failedWorkers.includes(workerId)) 
      workFlowStatus.failedWorkers.push(workerId);
  })

  console.log(`[${traceId}] ScanWorkflow result: ${JSON.stringify(scanWorkflowResult)}`);

  await syncWorkflow.signal('isScanCompleted', {})

  const syncWorkflowResult = await syncWorkflow.result()
  workFlowStatus.isSyncIsRunning = false;
  if(syncWorkflowResult.status === JobRunStatus.Errored) 
    workFlowStatus.isJobFailed = true;
  syncWorkflowResult.failedWorkers.map((workerId) => {
    if(!workFlowStatus.failedWorkers.includes(workerId)) 
      workFlowStatus.failedWorkers.push(workerId);
  })
  console.log(`[${traceId}] SyncWorkflow result: ${JSON.stringify(syncWorkflowResult)}`);


  if(workFlowStatus.setupCompletedWorkers.length === workFlowStatus.failedWorkers.length) {
    console.error(`Fatal error occurred for all active workers for jobRun Id: ${traceId}`)
    workFlowStatus.isJobFailed = true;
  }

  await ReportingWorkflow(traceId, reportingSignal, workFlowStatus.isJobFailed);
  if(!workFlowStatus.isJobFailed) {
    await WaitingForApproval(traceId, unblockSignal)
  }

  if (workFlowStatus.setupCompletedWorkers.length > 0) {
    await Promise.all(
      workFlowStatus.setupCompletedWorkers.map(async (workerId) => {
      console.log(`[${traceId}] Starting CleanupWorkerWorkflow for workerId: ${workerId}`);
      try {
        return await wf.executeChild(CleanupWorkerWorkflow, {
        args: [{ jobRunId: traceId }],
        workflowId: `CleanupWorkerWorkflow-${traceId}-${workerId}`,
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
  const response = await cleanupJobContextActivity(traceId)
  console.log(`[${traceId}] CleanupJobContextActivity response: ${response}`);
  return workFlowStatus;
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