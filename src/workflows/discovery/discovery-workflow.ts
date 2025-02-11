import {
  ChildWorkflowCancellationType,
  ParentClosePolicy,
  proxyActivities,
} from '@temporalio/workflow';
import { executeChild } from '@temporalio/workflow';
import { SetupWorkerWorkflow } from '../setup/setup-worker-workflow';
import { CleanupWorkerWorkflow } from '../setup/cleanup-worker-workflow';
import {DiscoveryJobWorkflow } from './discovery-job-workflow';
import * as discoveryStatusUpdate from '../../activities/discovery/discovery-status-update';
import { boolean } from 'joi';

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}



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
  log(
    traceId,
    `Starting Discovery Workflow Hello: ${JSON.stringify(options)}`,
  );

  let activeWorkerIds=[];
  const responseArray = await Promise.all(
    payload.workers.map((workerId) =>
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
  result.map((r) => {
    log(traceId, `DiscoveryWorkflow response in setup workflow: ${JSON.stringify(r)}`);
    if (r.status === 'success') {
      activeWorkerIds.push(r.workerId);
    }
  });  

  if(activeWorkerIds.length === 0){
    return {
      traceId: traceId,
      status: 'error',
      message: `No active workers found for ${traceId} Discovery Cannot be Initiated`,
    };
  }


log(traceId, `Active workers: ${activeWorkerIds}`);
const discoveryResponse:any =  await Promise.all(
    activeWorkerIds.map((workerId) =>
      executeChild(DiscoveryJobWorkflow,{
        args: [
          {
            traceId: traceId
          },
        ],
        workflowId: `DiscoveryJobWorkflow-${traceId}`,
        taskQueue: `${traceId}-TaskQueue`,
        cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
        parentClosePolicy: ParentClosePolicy.TERMINATE,
      })
    )
  ).then((response) => {  
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
  });
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

  log(
    traceId,
    `DiscoveryWorkflow response: ${JSON.stringify(result)}`,
  );
  return result;
    
}
