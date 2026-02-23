/**
 * Upgrade Execution Workflow (Parent)
 *
 * Fans out WorkerUpgradeExecutionWorkflow to each worker in parallel.
 * Each child triggers the upgrade script on the worker machine and returns immediately.
 * Actual upgrade completion is tracked via the UPGRADED flag → bootstrap ACK flow.
 *
 * Runs on ParentWorkflow-TaskQueue (CP side).
 */

import {
  executeChild,
  ChildWorkflowCancellationType,
  ParentClosePolicy,
  log,
} from '@temporalio/workflow';
import { WorkerUpgradeExecutionWorkflow } from './worker-upgrade-execution.workflow';
import {
  UpgradeExecutionWorkflowInput,
  UpgradeExecutionWorkflowOutput,
  UpgradeExecutionResult,
} from './upgrade.types';

export async function UpgradeExecutionWorkflow(
  input: UpgradeExecutionWorkflowInput,
): Promise<UpgradeExecutionWorkflowOutput> {
  const { traceId, bundleId, workerIds, version } = input;

  log.info(`[${traceId}] UpgradeExecutionWorkflow starting for ${workerIds.length} workers, version ${version}, bundle ${bundleId}`);

  const workerPromises = workerIds.map(async (workerId): Promise<UpgradeExecutionResult> => {
    const taskQueue = `${workerId}-TaskQueue`;

    log.info(`[${traceId}] Triggering upgrade on worker ${workerId}, queue ${taskQueue}`);

    try {
      const result = await executeChild(WorkerUpgradeExecutionWorkflow, {
        args: [{ traceId, bundleId, workerId, version }],
        workflowId: `UpgradeExecution-${traceId}-${workerId}`,
        taskQueue,
        workflowExecutionTimeout: '5m',
        cancellationType: ChildWorkflowCancellationType.ABANDON,
        parentClosePolicy: ParentClosePolicy.ABANDON,
      });

      log.info(`[${traceId}] Worker ${workerId} upgrade ${result.status}`);
      return {
        workerId,
        status: result.status,
        message: result.message,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`[${traceId}] Worker ${workerId} upgrade trigger failed: ${errorMessage}`);
      return {
        workerId,
        status: 'failed',
        message: errorMessage,
        timestamp: new Date().toISOString(),
      };
    }
  });

  const results = await Promise.all(workerPromises);

  const triggeredCount = results.filter(r => r.status === 'triggered').length;
  const failedCount = results.filter(r => r.status === 'failed').length;

  let status: 'completed' | 'partial' | 'failed';
  if (failedCount === 0) {
    status = 'completed';
  } else if (triggeredCount > 0) {
    status = 'partial';
  } else {
    status = 'failed';
  }

  log.info(`[${traceId}] UpgradeExecutionWorkflow done: ${triggeredCount} triggered, ${failedCount} failed`);

  return {
    traceId,
    status,
    summary: { total: workerIds.length, triggered: triggeredCount, failed: failedCount },
    results,
  };
}
