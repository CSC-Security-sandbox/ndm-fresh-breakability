import { ChildWorkflowCancellationType, executeChild, ParentClosePolicy } from "@temporalio/workflow";
import { ListPathWorkerWorkflow } from "./list-path-worker.workflow";
import { WorkFlows } from "src/work-manager/work-manager.types";

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
  log( traceId, `Starting ListPathsWorkflow with args: ${JSON.stringify(payload)}`,);
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