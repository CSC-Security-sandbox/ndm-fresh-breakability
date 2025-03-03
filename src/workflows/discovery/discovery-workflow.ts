import {
  ChildWorkflowCancellationType,
  ParentClosePolicy,
  proxyActivities,
} from '@temporalio/workflow';
import { executeChild } from '@temporalio/workflow';
import { SetupWorkerWorkflow } from '../setup/setup-worker-workflow';
import { CleanupWorkerWorkflow } from '../setup/cleanup-worker-workflow';
import { DiscoveryJobWorkflow } from './discovery-job-workflow';
import { DiscoveryActivity } from 'src/activities/discovery/discovery.activities';
import * as wf from '@temporalio/workflow';
import { ReportingWorkflow } from '../reporting/reporting.workflow';

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}

export const reportingSignal =  wf.defineSignal<[string]>('reportingSignal');

const { getWorkerId, setJobState, getJobState } = proxyActivities<DiscoveryActivity>({ startToCloseTimeout: '5m' });
/**
 * This is parent workflow that will call SetupWorkerWorkflow for each workerId
 * @param traceId Unique identifier to trace the request
 * @param payload Payload containing workerIds and fileServer
 * @param options Options to pass to this workflow and all child workflows
 * @returns Returns the result of all child workflows
 */
export async function DiscoveryWorkflow({
  traceId,
  payload,
  options,
}): Promise<any> {
  log(traceId, `Starting Discovery Workflow Hello: ${JSON.stringify(options)}`);
  // const workerId = await getWorkerId();
  // log(traceId, `DiscoveryWorkflow workerId: ${workerId}`);
  const activeWorkerIds = [];
  const responseArray = await Promise.all(
    payload.workers.map(async (workerId) => {
      try {
        log(traceId, `Starting SetupWorkerWorkflow for workerId: ${workerId}`);
        return await executeChild(SetupWorkerWorkflow, {
          args: [ { jobRunId: traceId } ],
          workflowId: `SetupWorkerWorkflow-${traceId}-${workerId}`,
          taskQueue: `${workerId}-TaskQueue`,
          ...options,
          cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
          parentClosePolicy: ParentClosePolicy.TERMINATE,
        });
      } catch (error) {
        log(traceId, `Error in SetupWorkerWorkflow: ${error}`);
        throw error;
      }
    })
  );
  log(traceId, `DiscoveryWorkflow responseArray: ${JSON.stringify(responseArray)}`);

  let result = responseArray.flat();
  result.map((r) => {
    log(traceId, `DiscoveryWorkflow response in setup workflow: ${JSON.stringify(r)}`);
    if (r.status === 'success') {
      activeWorkerIds.push(r.workerId);
    }
  });  
  if(!activeWorkerIds.length) {
    log(traceId, `No active workers found`);
    return {
      traceId: traceId,
      status: 'error',
      message: `No active workers found for ${traceId}`,
    }
  }
  log(traceId, `DiscoveryWorkflow activeWorkerIds: ${JSON.stringify(activeWorkerIds)}`);
  
  const discoveryResponse: any = await Promise.all(activeWorkerIds.map(async (workerId) => {
    const jobState = await getJobState(traceId);
    const uniqueWorkers = jobState.workers.includes(workerId) ? jobState.workers : [...jobState.workers, workerId];
    const newJobState = { ...jobState, workers: uniqueWorkers, status: 'RUNNING' } as any;
    await setJobState(traceId, newJobState);
    log(traceId, `Starting DiscoveryJobWorkflow for workerId: ${workerId}`);
    while (true) {
      try {
        return await executeChild(DiscoveryJobWorkflow, {
          args: [{ traceId, workerId }],
          workflowId: `DiscoveryJobWorkflow-${traceId}`,
          taskQueue: `${workerId}-TaskQueue`,
          cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
          parentClosePolicy: ParentClosePolicy.TERMINATE,
        });
      } catch (err) {
        if (err.name === 'ContinueAsNew') {
          console.log(`Child workflow continued as new: ${err.workflowId}`);
          continue; // Loop again to wait for the continued execution
        }
        throw err;
      }
    }
  })).then((response) => {
    log(traceId, `DiscoveryWorkflow response: ${JSON.stringify(response)}`);
    return {
      traceId: traceId,
      status: 'sucess',
      message: `Discovery Successfully  completed for ${traceId}`,
    };

  }).catch((error) => {
    log(traceId, `DiscoveryWorkflow error: ${error}`);
    return {
      traceId: traceId,
      status: 'error',
      message: `Failed to do discovery for  ${traceId} : ${error}`,
    };
  });;

  console.log("disoovery response" + JSON.stringify(discoveryResponse));
  result.push(discoveryResponse);

  const cleanupResponse = await Promise.all(
    activeWorkerIds.map(async (workerId) => {
      log(traceId, `Starting CleanupWorkerWorkflow for workerId: ${workerId}`);
      try {
        return await executeChild(CleanupWorkerWorkflow, {
          args: [{ jobRunId: traceId }],
          workflowId: `CleanupWorkerWorkflow-${traceId}`,
          taskQueue: `${workerId}-TaskQueue`,
          ...options,
          cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
          parentClosePolicy: ParentClosePolicy.TERMINATE,
        });
      } catch (error) {
        log(traceId, `Error in CleanupWorkerWorkflow: ${error}`);
        throw error;
      }
    }),
  );

    cleanupResponse.flat().map((r) =>
      result.push(r),
    );

  await ReportingWorkflow(traceId, reportingSignal)

  log(traceId, `DiscoveryWorkflow response: ${JSON.stringify(result)}`);
  return discoveryResponse;
}
