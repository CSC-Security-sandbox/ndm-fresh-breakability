import { ChildWorkflowCancellationType, executeChild, ParentClosePolicy } from "@temporalio/workflow";
import { CleanupWorkerWorkflow, SetupWorkerWorkflow, SyncWorkflow } from "src/workflows/workflows";
import { ScanWorkflow } from "../core/scan.workflow";

interface MigrationWorkflowInput {
  traceId: string;
  payload: {
    workers: string[];
  };
  options?: Record<string, any>; 
}

async function log(traceId: string, message: string): Promise<void> {
  console.log(`[${traceId}] ${message}`);
}

export const MigrationWorkflow = async ({
  traceId,
  payload,
  options = {},
}: MigrationWorkflowInput): Promise<any> => {
  await log(traceId, `MigrationWorkflow: ${JSON.stringify(payload)}`);

  const activeWorkerIds: string[] = [];
  const setupResponses = await Promise.all(
    payload.workers.map((workerId) =>
      executeChild(SetupWorkerWorkflow, {
        args: [{ jobRunId: traceId }],
        workflowId: `SetupWorkerWorkflow-${traceId}-${workerId}`,
        taskQueue: `${workerId}-TaskQueue`,
        ...options,
        cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
        parentClosePolicy: ParentClosePolicy.TERMINATE,
      })
    )
  );

  const result = setupResponses.flat();

  result.forEach((r) => {
    log(traceId, `MigrationWorkflow response in setup workflow: ${JSON.stringify(r)}`);
    if (r.status === 'success') {
      activeWorkerIds.push(r.workerId);
    }
  });

  if (activeWorkerIds.length === 0) {
    return {
      traceId,
      status: 'error',
      message: `No active workers found for ${traceId}. Migration cannot be initiated.`,
    };
  }

  const scanResponse = await Promise.all(
    activeWorkerIds.map(async (workerId) => {
      while (true) {
        try {
          return await executeChild(ScanWorkflow, {
            args: [{ jobRunId: traceId }],
            workflowId: `ScanWorkflow-${traceId}-${workerId}`,
            taskQueue: `${workerId}-TaskQueue`,
            cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
            parentClosePolicy: ParentClosePolicy.TERMINATE,
          });
        } catch (err: any) {
          if (err.name === 'ContinueAsNew') {
            console.log(`Child workflow continued as new: ${err.workflowId}`);
            continue;
          }
          throw err;
        }
      }
    })
  )
    .then((response) => {
      log(traceId, `ScanWorkflow response: ${JSON.stringify(response)}`);
      return {
        traceId,
        status: 'success',
        message: `ScanWorkflow successfully completed for ${traceId}`,
      };
    })
    .catch((error) => {
      log(traceId, `ScanWorkflow error: ${error}`);
      return {
        traceId,
        status: 'error',
        message: `Failed to perform scan for ${traceId}: ${error}`,
      };
    });
  console.log("scanResponse response: " + JSON.stringify(scanResponse));
  result.push(scanResponse);

  const syncResponse = await Promise.all(
    activeWorkerIds.map(async (workerId) => {
      while (true) {
        try {
          return await executeChild(SyncWorkflow, {
            args: [{ jobRunId: traceId }],
            workflowId: `SyncWorkflow-${traceId}-${workerId}`,
            taskQueue: `${workerId}-TaskQueue`,
            cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
            parentClosePolicy: ParentClosePolicy.TERMINATE,
          });
        } catch (err: any) {
          if (err.name === 'ContinueAsNew') {
            console.log(`Child workflow continued as new: ${err.workflowId}`);
            continue;
          }
          throw err;
        }
      }
    })
  )
    .then((response) => {
      log(traceId, `SyncWorkflow response: ${JSON.stringify(response)}`);
      return {
        traceId,
        status: 'success',
        message: `SyncWorkflow successfully completed for ${traceId}`,
      };
    })
    .catch((error) => {
      log(traceId, `SyncWorkflow error: ${error}`);
      return {
        traceId,
        status: 'error',
        message: `Failed to perform sync for ${traceId}: ${error}`,
      };
    });
  console.log("SyncResponse response: " + JSON.stringify(syncResponse));
  result.push(syncResponse);

  await log(traceId, `Active workers: ${activeWorkerIds.join(', ')}`);

  if (activeWorkerIds.length > 0) {
    const cleanupResponses = await Promise.all(
      activeWorkerIds.map(async(workerId) => {
        return await executeChild(CleanupWorkerWorkflow, {
          args: [{ jobRunId: traceId }],
          workflowId: `CleanupWorkerWorkflow-${traceId}-${workerId}`,
          taskQueue: `${workerId}-TaskQueue`,
          ...options,
          cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
          parentClosePolicy: ParentClosePolicy.TERMINATE,
        })
      }
      )
    );
    cleanupResponses.flat().forEach((r) => result.push(r));
  }

  await log(traceId, `MigrationWorkflow response: ${JSON.stringify(result)}`);
  return result;
};
