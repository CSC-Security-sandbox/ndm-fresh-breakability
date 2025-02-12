import { ChildWorkflowCancellationType, executeChild, ParentClosePolicy } from "@temporalio/workflow";
import { strict } from "node:assert";
import { SetupMigratorWorkFlow } from "../setup/setup-migrator.workflow";

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}


export const MigrationWorkflow = async ({
  traceId,
  payload,
  options,
}) => {

  log( traceId, `MigrationWorkflow: ${JSON.stringify(options)} `);

  let activeWorkerIds:string[]=[];
  const responseArray = await Promise.all(
    payload.workers.map((workerId) =>
      executeChild(SetupMigratorWorkFlow, {
        args: [
          { jobRunId:traceId },
        ],
        workflowId: `SetupMigratorWorkFlow-${traceId}-${workerId}`,
        taskQueue: `${workerId}-TaskQueue`,
        ...options,
        cancellationType:
          ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
        parentClosePolicy: ParentClosePolicy.TERMINATE,
      }),
    ),
  );

}