import * as wf from '@temporalio/workflow';
import {
    ChildWorkflowCancellationType,
    ParentClosePolicy, defineSignal
} from "@temporalio/workflow";
import { CommonActivityService } from "src/activities/common/common.service";
import { JobRunStatus } from "src/activities/discovery/enums";
import { CleanupWorkerWorkflow, ReportingWorkflow } from "src/workflows/workflows";
import { DiscoveryJobRequest } from "./discovery-workflow.type";
import { waitUntilRedisMemoryOk } from 'src/workflows/utils/memory-utils';

interface DiscoveryWorkflowOutput {
    traceId: string;
    setupCompletedWorkers:string[];
    failedWorkers:string[];
    setupFailedWorkerCount: number;
    newAddedWorkerCount: number;
    isScanIsRunning: boolean;
    isJobFailed: boolean;
  }

interface WorkerConfig {
    ids: string[];
}  

export const registerNewWorkerSignal = defineSignal<[WorkerConfig]>('registerNewWorker');
export const reportingSignal =  wf.defineSignal<[string]>('reportingSignal');

const {
  updateJobErrorStatus: updateJobErrorActivity,
  updateWorkerResponse: updateWorkerResponse,
  cleanupJobContext: cleanupJobContextActivity,
} = wf.proxyActivities<CommonActivityService>({ startToCloseTimeout: '5h' });


export async function DiscoveryWorkflow({traceId, payload, options}:DiscoveryJobRequest): Promise<DiscoveryWorkflowOutput> {
    console.log(`[${traceId}] Parent workflow started for ${traceId}`);

    let scanWorkflow: wf.ChildWorkflowHandle<wf.Workflow>;

    const workFlowStatus: DiscoveryWorkflowOutput = {
        failedWorkers: [],
        setupCompletedWorkers: [],
        setupFailedWorkerCount: 0,
        newAddedWorkerCount: 0, 
        isJobFailed: false,
        isScanIsRunning: false,
        traceId: traceId,    
      }
    
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
            }}
            catch(error) {
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

    console.log(`[${traceId}] Setup completed for ${workFlowStatus.setupFailedWorkerCount}, ${payload.workers.length}, ${workFlowStatus.newAddedWorkerCount}`);
    
    await wf.condition(() => (workFlowStatus.setupCompletedWorkers.length > 0) || (workFlowStatus.setupFailedWorkerCount === (payload.workers.length+workFlowStatus.newAddedWorkerCount)));

    if(workFlowStatus.setupFailedWorkerCount === (payload.workers.length+workFlowStatus.newAddedWorkerCount)) {
      console.error(`Fatal error occurred for all active workers for jobRun Id: ${traceId}`)
      await updateJobErrorActivity(traceId)
    }
    
    await waitUntilRedisMemoryOk(traceId)

    // scan workflow
    scanWorkflow = await wf.startChild('DiscoveryJobWorkflow', {
        args: [ { jobRunId: traceId, workers:workFlowStatus.setupCompletedWorkers, failedWorkers: [] } ],
        workflowId: `DiscoveryJobWorkflow-${traceId}`,
        taskQueue: `${traceId}-TaskQueue`,
        cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
        parentClosePolicy: ParentClosePolicy.TERMINATE,
    });
    workFlowStatus.isScanIsRunning = true;

    const scanWorkflowResult = await scanWorkflow.result()
    workFlowStatus.isScanIsRunning = false;
    if(scanWorkflowResult.status === JobRunStatus.Errored) 
        workFlowStatus.isJobFailed = true;
    scanWorkflowResult.failedWorkers.map((workerId) => {
        if(!workFlowStatus.failedWorkers.includes(workerId)) 
        workFlowStatus.failedWorkers.push(workerId);
    })



    if(workFlowStatus.setupCompletedWorkers.length === workFlowStatus.failedWorkers.length) {
      console.error(`Fatal error occurred for all active workers for jobRun Id: ${traceId}`)
      workFlowStatus.isJobFailed = true;
    }

    await ReportingWorkflow(traceId, reportingSignal, workFlowStatus.isJobFailed);


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
    return workFlowStatus
}