import { ChildWorkflowCancellationType, executeChild, ParentClosePolicy } from "@temporalio/workflow";
import { CleanupWorkerWorkflow, SetupWorkerWorkflow } from "src/workflows/workflows";
import { ScanWorkflow } from "../core/scan.workflow";

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}


export const MigrationWorkflow = async ({
  traceId,
  payload,
  options,
}) => {

  log( traceId, `MigrationWorkflow: ${JSON.stringify(options)}`);

  let activeWorkerIds:string[]=[];
  const responseArray = await Promise.all(
    payload.workers.map((workerId) =>
      executeChild(SetupWorkerWorkflow, {
        args: [
          { jobRunId:traceId },
        ],
        workflowId: `SetupMigratorWorkFlow-${traceId}-${workerId}`,
        taskQueue: `${workerId}-TaskQueue`,
        cancellationType:
          ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
        parentClosePolicy: ParentClosePolicy.TERMINATE,
      }),
    )
  );

  let result = responseArray.flat();

  result.map((r) => {
    log(traceId, `MigrationWorkflow response in setup workflow: ${JSON.stringify(r)}`);
    if (r.status === 'success') {
      activeWorkerIds.push(r.workerId);
    }
  });  

  const scanResponse = await Promise.all(
    payload.workers.map((workerId) =>
      executeChild(ScanWorkflow, {
        args: [
          { jobRunId:traceId },
        ],
        workflowId: `ScanWorkflow-${traceId}-${workerId}`,
        taskQueue: `${workerId}-TaskQueue`,
        // ...options,
        cancellationType:
          ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
        parentClosePolicy: ParentClosePolicy.TERMINATE,
      }),
    )
  )
  console.log("scanResponse response" + JSON.stringify(scanResponse));
  result.push(scanResponse.flat())

  log(traceId, `Active workers: ${activeWorkerIds}`);

  // if (activeWorkerIds.length > 0) {
  //   const cleanupResponse = await Promise.all(
  //     activeWorkerIds.map((workerId) =>
  //       executeChild(CleanupWorkerWorkflow, {
  //         args: [
  //           {
  //             jobRunId: traceId,
  //           },
  //         ],
  //         workflowId: `CleanupWorkerWorkflow-${traceId}-${workerId}`,
  //         taskQueue: `${workerId}-TaskQueue`,
  //         ...options,
  //         cancellationType:
  //           ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
  //         parentClosePolicy: ParentClosePolicy.TERMINATE,
  //       }),
  //     ),
  //   );

  //   cleanupResponse.flat().map((r) =>
  //     result.push(r),
  //   );
  // }

  log(traceId, `MigrationWorkflow response: ${JSON.stringify(result)}`);
  return result;
}