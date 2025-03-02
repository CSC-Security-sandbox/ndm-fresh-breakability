import { ChildWorkflowCancellationType, executeChild, ParentClosePolicy } from "@temporalio/workflow";
import { CleanupWorkerWorkflow, SetupWorkerWorkflow, SyncWorkflow } from "src/workflows/workflows";
import { ScanWorkflow } from "../core/scan.workflow";
import * as wf from '@temporalio/workflow';
import { MigrationTaskService } from "src/activities/migrate/migrate.taskmanager.service";
import { JobRunStatus } from "src/activities/discovery/enums";
import { CutOverStatus } from "src/activities/migrate/migrate.type";
import { ReportingWorkflow } from "src/workflows/reporting/reporting.workflow";


export const unblockSignal =  wf.defineSignal<[string]>('approve');
export const reportingSignal =  wf.defineSignal<[string]>('reportingSignal');
export const isBlockedQuery = wf.defineQuery<boolean>('isBlocked');


const {
  updateStatus: updateStatusActivity,
  updateCutOverStatus: updateCutOverStatusActivity
} = wf.proxyActivities<MigrationTaskService>({ startToCloseTimeout: '5h' });


interface CutOverWorkFlowInput {
  traceId: string;
  payload: {
    workers: string[];
  };
  options?: Record<string, any>; 
}

async function log(traceId: string, message: string): Promise<void> {
  console.log(`[${traceId}] ${message}`);
}

export const CutOverWorkFlow = async ({
  traceId,
  payload,
  options = {},
}: CutOverWorkFlowInput): Promise<any> => {
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
  ).then((response) => {
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

  await ReportingWorkflow(traceId, reportingSignal)
  await WaitingForApproval(traceId, unblockSignal)


  if (activeWorkerIds.length > 0) {
    const cleanupResponses = await Promise.all(
      activeWorkerIds.map((workerId) =>  executeChild(CleanupWorkerWorkflow, {
          args: [{ jobRunId: traceId }],
          workflowId: `CleanupWorkerWorkflow-${traceId}-${workerId}`,
          taskQueue: `${workerId}-TaskQueue`,
          ...options,
          cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
          parentClosePolicy: ParentClosePolicy.TERMINATE,
        })
      )
    );
    cleanupResponses.flat().forEach((r) => result.push(r));
  }

  await log(traceId, `MigrationWorkflow response: ${JSON.stringify(result)}`);

  return result;
};

export const WaitingForApproval = async (
  traceId: string,
  approve_signal: wf.SignalDefinition<[string], string>
): Promise<string> => {
  let isBlocked = true;
  let approval_status: CutOverStatus | undefined;

  await updateStatusActivity({jobRunId: traceId,  status: JobRunStatus.BLOCKED})

  wf.setHandler(isBlockedQuery, () => isBlocked);

  wf.setHandler(approve_signal, (input: string) => {
    console.error(input)
    if((input == CutOverStatus.APPROVED) || (input == CutOverStatus.REJECTED) ) {
      approval_status = input;
      isBlocked = false;
    }
  });

  wf.log.info('Waiting for approval...');

  try {
    await wf.condition(() => !isBlocked);
    await updateCutOverStatusActivity({jobRunId: traceId,  status: approval_status })
    wf.log.info(`Cutover approval received: ${approval_status}`);
    console.error(`Cutover approval received: ${approval_status}`);

  } catch (err) {
    if (err instanceof wf.CancelledFailure) {
      wf.log.info('Workflow cancelled');
    }
    throw err;
  }

  return approval_status ?? 'No approval received';
};