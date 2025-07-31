import { ChildWorkflowCancellationType, executeChild, ParentClosePolicy, proxyActivities } from "@temporalio/workflow";
import { ValidatePathWorkerWorkflow } from "./validate-path-worker-workflow";
import { ValidatePathActivity } from 'src/activities/validate-path/validate-path.service';
import { WorkFlows } from "src/work-manager/work-manager.types";

async function log(traceId: string, message: string) {
    console.log(`[${traceId}] ${message}`);
}

const { postValidationResult } = proxyActivities<ValidatePathActivity>({ startToCloseTimeout: '5m' });


export const ValidatePathsWorkflow = async ({traceId, payload, options}) => {
  log( traceId, `Starting ValidatePathsWorkflow with args: ${JSON.stringify(payload)}`,);
    const responseArray = await Promise.all(
      payload.workerIds.map((workerId) =>
        executeChild(ValidatePathWorkerWorkflow, {
          args: [
            {
              traceId: traceId,
              paths: payload.paths,
              fileServer: payload.fileServer,
              workerId: workerId,
            }
          ],
          workflowId: `${WorkFlows.VALIDATE_PATHS}-${traceId}-${workerId}`,
          taskQueue: `${workerId}-TaskQueue`,
          ...options,
          cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
          parentClosePolicy: ParentClosePolicy.TERMINATE,
        }),
      ),
    );
    // post the validation results to config service
    const result = responseArray.flat();

    await postValidationResult(traceId, result);

    log(traceId, `ValidatePathsWorkflow response: ${JSON.stringify(result)}`);
    return result;
}
