import { ChildWorkflowCancellationType, executeChild, ParentClosePolicy } from "@temporalio/workflow";
import { WorkFlows } from "../../work-manager/work-manager.types";
import { ListPathWorkerWorkflow } from "./list-path-worker.workflow";

async function log(traceId: string, message: string) {
    console.log(`[${traceId}] ${message}`);
}
/**
 * This is parent workflow that will call ListPathsWorkflow for each workerId
 * @param traceId Unique identifier to trace the request
 * @param payload Payload containing workerIds and fileServer
 * @param options Options to pass to this workflow and all child workflows
 * @returns Returns the result of all child workflows
 */
export const ListPathsWorkflow = async ({traceId, payload, options}) => {
  log( traceId, `Starting ListPathsWorkflow`,);
    const responseArray = await Promise.all(
      payload.workerIds.map((workerId) =>
        executeChild(ListPathWorkerWorkflow, {
          args: [
            {
              traceId: traceId,
              fileServer: payload.fileServer,
            }
          ],
          workflowId: `${WorkFlows.LIST_PATHS}-${traceId}-${workerId}`,
          taskQueue: `${workerId}-TaskQueue`,
          ...options,
          cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
          parentClosePolicy: ParentClosePolicy.TERMINATE,
        }),
      ),
    );
  
    const result = responseArray.flat();
    log(
      traceId, `ListPathsWorkflow response: ${JSON.stringify(result)}`,
    );
    return result;
}