import { defineSignal } from "@temporalio/workflow";
import { DiscoveryJobRequest } from "./discovery-workflow.type";
import * as wf from '@temporalio/workflow';
import { CleanupWorkerWorkflow, DiscoveryJobWorkflow, ReportingWorkflow, SetupWorkerWorkflow } from "src/workflows/workflows";
import {
    ChildWorkflowCancellationType,
    ParentClosePolicy,
    condition
  } from '@temporalio/workflow';
import { CommonActivityService } from "src/activities/common/common.service";

interface WorkerConfig {
    ids: string[];
}  

export const registerNewWorkerSignal = defineSignal<[WorkerConfig]>('registerNewWorker');
export const reportingSignal =  wf.defineSignal<[string]>('reportingSignal');

const {
  getJobState: getJobStateActivity,
  updateJobErrorStatus: updateJobErrorActivity
} = wf.proxyActivities<CommonActivityService>({ startToCloseTimeout: '5h' });


export async function DiscoveryWorkflow({traceId, payload, options}:DiscoveryJobRequest) {
    console.log(`[${traceId}] Parent workflow started for ${traceId}`);
    const output = [];
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

    await condition(() => setupCompletedWorkers.length > 0);

    const response = await wf.executeChild(DiscoveryJobWorkflow, {
        args: [{ traceId }],
        workflowId: `DiscoveryJobWorkflow-${traceId}`,
        taskQueue: `${traceId}-TaskQueue`,
        cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
        parentClosePolicy: ParentClosePolicy.TERMINATE,
    })

    
    let jobState = await getJobStateActivity(traceId);
    let errored = jobState.failedWorkers.length === setupCompletedWorkers.length;

    if(errored) {
        console.error(`Fatal error occurred for all active workers for jobRun Id: ${traceId}`)
        await updateJobErrorActivity(traceId)
    }
    
    if (setupCompletedWorkers.length > 0) {
        await ReportingWorkflow(traceId, reportingSignal)
        const cleanupResponse = await Promise.all(
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
        );
        cleanupResponse.flat().map((r) =>
            output.push(r),
            );
    }
    return {output, response}
}