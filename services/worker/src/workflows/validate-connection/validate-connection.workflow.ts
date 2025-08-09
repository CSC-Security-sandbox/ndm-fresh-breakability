import { ChildWorkflowCancellationType, executeChild, ParentClosePolicy } from "@temporalio/workflow";

import { ValidateWorkerConnectionWorkflow } from "./validate-worker-connection.workflow";
import { WorkFlows } from "src/work-manager/work-manager.types";


async function log(traceId: string, message: string) {
    console.log(`[${traceId}] ${message}`);
}
/**
 * This is parent workflow that will call ValidateWorkerConnectionWorkflow for each workerId
 * @param traceId Unique identifier to trace the request
 * @param payload Payload containing workerIds and fileServer
 * @param options Options to pass to this workflow and all child workflows
 * @returns Returns the result of all child workflows
 */
export const ValidateConnectionsWorkflow = async ({traceId, payload, options}) => {
  log( traceId, `Starting ValidateConnectionWorkflow with args: ${JSON.stringify(payload)}`,);
  const responseArray = await Promise.all(
    payload.workerIds.map((workerId) =>
      executeChild(ValidateWorkerConnectionWorkflow, {
        args: [
          {
            traceId: traceId,
            fileServer: payload.fileServer,
            feature: payload.feature
          }
        ],
        workflowId: `${WorkFlows.VALIDATE_CONNECTION}-${traceId}-${workerId}`,
        taskQueue: `${workerId}-TaskQueue`,
        ...options,
        cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
        parentClosePolicy: ParentClosePolicy.TERMINATE,
      }),
    ),
  );
  
  const result = responseArray.flat();
  log(
    traceId, `ValidateConnectionWorkflow response: ${JSON.stringify(result)}`,
  );
  return result;
}