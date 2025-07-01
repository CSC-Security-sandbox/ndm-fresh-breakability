import { FatalError } from './../../../errors/errors.types';
import * as wf from '@temporalio/workflow';
import { ChildWorkflowCancellationType, ParentClosePolicy } from "@temporalio/workflow";
import { CommonActivityService } from "src/activities/common/common.service";

import { waitUntilRedisMemoryOk } from 'src/workflows/utils/memory-utils';
import { CleanupWorkerWorkflow } from "src/workflows/workflows";
import { orchestrateChildWorkflows } from '../common/workflow-utils';
import { WorkflowStatus } from '../chid-scan.workflow.type';
import { ReportingWorkflow } from '../common/reporting-workflow';


interface MigrationWorkflowInput {
  traceId: string;
  payload: {
    workers: string[];
  };
  options?: Record<string, any>; 
}
interface MigrationWorkflowOutput {
  traceId: string;
  setupCompletedWorkers:string[];
  failedWorkers:string[];
  setupFailedWorkerCount: number;
  newAddedWorkerCount: number;
  isScanIsRunning: boolean;
  isSyncIsRunning: boolean; 
  isJobFailed: boolean;
}

interface WorkerConfig {
  ids: string[];
}  

export const reportingSignal =  wf.defineSignal<[string]>('reportingSignal');
export const actionSignal = wf.defineSignal<[string]>('action');

const {
  updateJobErrorStatus: updateJobErrorActivity,
  updateWorkerResponse: updateWorkerResponse,
  cleanupJobContext: cleanupJobContextActivity,
} = wf.proxyActivities<CommonActivityService>({ startToCloseTimeout: '5h' });


export const MigrationWorkflow = async ({
  traceId,
  payload,
  options = {},
}: MigrationWorkflowInput): Promise<MigrationWorkflowOutput> => {
  console.log(`[${traceId}] Parent workflow started for ${traceId}`);

  const workFlowStatus: MigrationWorkflowOutput = {
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
      }
    } catch(error) {
      workFlowStatus.setupFailedWorkerCount++;
      await updateWorkerResponse(traceId, worker, {
        status: 'FAILED',
        code: 'SETUP_WORKER_FAILURE',
        operation: 'Worker Setup Failed',
        occurrence: 1,
        origin: 'Worker',
        message: error.message,
        createdAt: new Date()
      });
      console.error(`[${traceId}] Error in SetupWorkerWorkflow: ${error}`);
    }
  })

  await wf.condition(() => (workFlowStatus.setupCompletedWorkers.length > 0) || (workFlowStatus.setupFailedWorkerCount === (payload.workers.length+workFlowStatus.newAddedWorkerCount)));

  if(workFlowStatus.setupFailedWorkerCount === (payload.workers.length+workFlowStatus.newAddedWorkerCount)) {
    console.error(`Fatal error occurred for all active workers for jobRun Id: ${traceId}`)
    await updateJobErrorActivity(traceId)
    //TODO: throw wf.nonRetryableError. 
    throw new FatalError("Fatal error occurred for all active workers");
  }
  
  // wait until redis has enough memory
  await waitUntilRedisMemoryOk(traceId);

  const orchestrationworkflowStatus: WorkflowStatus =  await orchestrateChildWorkflows(traceId, actionSignal);
 
  await ReportingWorkflow(traceId, reportingSignal, orchestrationworkflowStatus);

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
          if(error instanceof wf.ActivityFailure){
              console.error(`[${traceId}] ActivityFailure in CleanupWorkerWorkflow with message: ${error.message}`);   
          }
          throw error;
                  
      }
    }),
    )
  }
  // const response = await cleanupJobContextActivity(traceId)
  // console.log(`[${traceId}] CleanupJobContextActivity response: ${response}`);
  return workFlowStatus;
};
