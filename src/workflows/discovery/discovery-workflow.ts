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
  log(traceId, `Starting Discovery Workflow Hello: ${JSON.stringify(options)}`);
  const workerId = await getWorkerId();
  log(traceId, `DiscoveryWorkflow workerId: ${workerId}`);
  let activeWorkerIds = [workerId];
  const responseArray = await Promise.all(
    activeWorkerIds.map((workerId) =>
      executeChild(SetupWorkerWorkflow, {
        args: [
          {
            jobRunId: traceId,
          },
        ],
        workflowId: `SetupWorkerWorkflow-${traceId}-${workerId}`,
        taskQueue: `${workerId}-TaskQueue`,
        ...options,
        cancellationType:
          ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
        parentClosePolicy: ParentClosePolicy.TERMINATE,
      }),
    ),
  );

  let result = responseArray.flat();
  
  if (activeWorkerIds.length === 0) {
    return {
      traceId: traceId,
      status: 'error',
      message: `No active workers found for ${traceId} Discovery Cannot be Initiated`,
    };
  }

  const discoveryResponse: any = await Promise.all(payload.workers.map(async (workerId) => {
    const jobState = await getJobState(traceId);
    const uniqueWorkers = jobState.workers.includes(workerId) ? jobState.workers : [...jobState.workers, workerId];
    const newJobState = { 
      ...jobState,
      workers: uniqueWorkers,
      status: 'RUNNING',
    } as any;
    await setJobState(traceId, newJobState);
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
  let discoveryResult = discoveryResponse;
  result.push(discoveryResult);


  if (activeWorkerIds.length > 0) {
    const cleanupResponse = await Promise.all(
      activeWorkerIds.map((workerId) =>
        executeChild(CleanupWorkerWorkflow, {
          args: [
            {
              jobRunId: traceId,
            },
          ],
          workflowId: `CleanupWorkerWorkflow-${traceId}-${workerId}`,
          taskQueue: `${workerId}-TaskQueue`,
          ...options,
          cancellationType:
            ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
          parentClosePolicy: ParentClosePolicy.TERMINATE,
        }),
      ),
    );

    cleanupResponse.flat().map((r) =>
      result.push(r),
    );
  }

  log(traceId, `DiscoveryWorkflow response: ${JSON.stringify(result)}`);
  return discoveryResponse;
}
