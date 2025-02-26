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

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}

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
  log(traceId, `Starting Discovery Parent Workflow : ${JSON.stringify(options)}`);
  const workerId = await getWorkerId();
  log(traceId, `DiscoveryWorkflow workerId: ${workerId}`);
  if (!workerId) return { traceId: traceId, status: 'error', message: `Failed to get workerId for ${traceId}` };

  let setupWorkerResponse;
  try {
    log(traceId, `Starting SetupWorkerWorkflow for workerId: ${workerId}`);
    setupWorkerResponse = await executeChild(SetupWorkerWorkflow, {
      args: [{ jobRunId: traceId }],
      workflowId: `SetupWorkerWorkflow-${traceId}-${workerId}`,
      taskQueue: `${workerId}-TaskQueue`,
      ...options,
      cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
      parentClosePolicy: ParentClosePolicy.TERMINATE,
    });
    log(traceId, `SetupWorkerWorkflow response: ${JSON.stringify(setupWorkerResponse)}`);
  } catch (error) {
    console.error(`Failed to execute child workflow for worker ${workerId}:`, error);
    return { traceId: traceId, status: 'error', message: `Failed to setup worker ${workerId} for ${traceId}` }
  }

  let discoveryResponse;
  try {
    log(traceId, `Get job state for traceId: ${traceId}`);
    const jobState = await getJobState(traceId);
    const uniqueWorkers = jobState.workers.includes(workerId) ? jobState.workers : [...jobState.workers, workerId];
    const newJobState = { ...jobState, workers: uniqueWorkers, status: "RUNNING" };
    await setJobState(traceId, newJobState);
    log(traceId, `DiscoveryWorkflow newJobState: ${JSON.stringify(newJobState)} for workerId: ${workerId}`);

    while (true) {
      try {
        log(traceId, `Starting DiscoveryJobWorkflow for workerId: ${workerId}`);
        discoveryResponse = await executeChild(DiscoveryJobWorkflow, {
          args: [{ traceId, workerId }],
          workflowId: `DiscoveryJobWorkflow-${traceId}`,
          taskQueue: `${workerId}-TaskQueue`,
          cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
          parentClosePolicy: ParentClosePolicy.TERMINATE,
        });
        break;
      } catch (err) {
        if (err.name === "ContinueAsNew") {
          console.log(`Child workflow continued as new: ${err.workflowId}`);
          continue;
        }
        throw err;
      }
    }
    log(traceId, `DiscoveryJobWorkflow response: ${JSON.stringify(discoveryResponse)}` );
    discoveryResponse = { traceId, status: "success", message: `Discovery successfully completed for ${traceId}` };
  } catch (error) {
    log(traceId, `DiscoveryWorkflow error: ${error}`);
    discoveryResponse = { traceId, status: "error", message: `Failed to do discovery for ${traceId}: ${error}` };
  }


  let cleanupResponse;
  try {
    log(traceId, `Starting CleanupWorkerWorkflow for workerId: ${workerId}`);
    cleanupResponse = await executeChild(CleanupWorkerWorkflow, {
      args: [{ jobRunId: traceId }],
      workflowId: `CleanupWorkerWorkflow-${traceId}-${workerId}`,
      taskQueue: `${workerId}-TaskQueue`,
      ...options,
      cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
      parentClosePolicy: ParentClosePolicy.TERMINATE,
    });
    log(traceId, `CleanupWorkerWorkflow response: ${JSON.stringify(cleanupResponse)}`);
  } catch (error) {
    console.error(`CleanupWorkerWorkflow failed for worker ${workerId}:`, error);
    return { traceId: traceId, status: 'error', message: `Failed to cleanup worker ${workerId} for ${traceId}` }
  }
  log(traceId, `DiscoveryWorkflow response: ${JSON.stringify({ setupWorkerResponse, discoveryResponse, cleanupResponse })}`);
  return discoveryResponse;
}
