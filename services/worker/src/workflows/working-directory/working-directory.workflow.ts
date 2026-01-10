import { ChildWorkflowCancellationType, executeChild, ParentClosePolicy } from "@temporalio/workflow";
import { ValidateWorkingDirectoryWorkerWorkflow } from "./working-directory-worker.workflow";
import { WorkFlows } from "src/work-manager/work-manager.types";

async function log(traceId: string, message: string) {
    console.log(`[${traceId}] ${message}`);
}

export const ValidateWorkingDirectoryWorkflow = async ({traceId, payload, options}) => {
  log(`traceId - ${traceId}`, `Starting ValidateWorkingDirectoryWorkflow with args: ${JSON.stringify(payload)}`);
    // Include fileServerId in workflow ID to ensure uniqueness when same worker handles multiple zones (Dell)
    const fileServerSuffix = payload.fileServerId ? `-${payload.fileServerId}` : '';
    const responseArray = await Promise.all(
      payload.workerIds.map((workerId: string) =>
        executeChild(ValidateWorkingDirectoryWorkerWorkflow, {
          args: [
            {
              traceId: traceId,
              payload: payload,
            }
          ],
          workflowId: `${WorkFlows.VALIDATE_EXPORT_PATH_AND_WORKING_DIRECTORY}-${traceId}-${workerId}-${fileServerSuffix}`,
          taskQueue: `${workerId}-TaskQueue`,
          ...options,
          cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
          parentClosePolicy: ParentClosePolicy.TERMINATE,
        }),
      ),
    );
  
    const result = responseArray.flat();
    log(
      traceId, `ValidateWorkingDirectoryWorkflow response: ${JSON.stringify(result)}`,
    );
    
    return result;
}
