/**
 * Binary Multicast Workflow
 * 
 * Parent workflow that distributes binaries to all workers.
 * Runs on ParentWorkflow-TaskQueue (CP side).
 * 
 * Flow:
 *   admin-service: POST /api/v1/upgrade/multicast
 *       │
 *       │ workflowService.startWorkflow('BinaryMulticastWorkflow', ...)
 *       │
 *       ▼
 *   BinaryMulticastWorkflow (this workflow, runs on ParentWorkflow-TaskQueue)
 *       │
 *       │ For each worker:
 *       │   executeChild(WorkerDownloadWorkflow, { taskQueue: '{workerId}-TaskQueue' })
 *       │
 *       ▼
 *   WorkerDownloadWorkflow (runs on each worker)
 *       │
 *       │ Downloads binary from CP
 *       │
 *       ▼
 *   Returns aggregated results
 */

import {
  executeChild,
  ChildWorkflowCancellationType,
  ParentClosePolicy,
  log,
} from '@temporalio/workflow';
import { WorkerDownloadWorkflow } from './worker-download.workflow';
import {
  BinaryMulticastWorkflowInput,
  BinaryMulticastWorkflowOutput,
  WorkerDownloadResult,
} from './upgrade.types';

// =============================================================================
// Workflow
// =============================================================================

/**
 * Binary Multicast Workflow
 * 
 * @param input - Workflow input containing traceId, workerIds, and version.
 *                Workers resolve their own CP URL and platform at runtime.
 * @returns Aggregated results from all workers
 */
export async function BinaryMulticastWorkflow(
  input: BinaryMulticastWorkflowInput
): Promise<BinaryMulticastWorkflowOutput> {
  const { traceId, bundleId, workerIds, version } = input;

  log.info(`[${traceId}] BinaryMulticastWorkflow starting for ${workerIds.length} workers, version ${version}, bundle ${bundleId}`);

  const results: WorkerDownloadResult[] = [];

  const workerPromises = workerIds.map(async (workerId) => {
    const taskQueue = `${workerId}-TaskQueue`;

    log.info(`[${traceId}] Starting download for worker ${workerId} on queue ${taskQueue}`);

    try {
      const result = await executeChild(WorkerDownloadWorkflow, {
        args: [{
          traceId,
          bundleId,
          workerId,
          version,
        }],
        workflowId: `WorkerDownload-${traceId}-${workerId}`,
        taskQueue,
        workflowExecutionTimeout: '60m',
        cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
        parentClosePolicy: ParentClosePolicy.TERMINATE,
      });

      const downloadResult: WorkerDownloadResult = {
        workerId,
        platform: result.platform,
        status: result.status,
        message: result.message,
        stagedPath: result.stagedPath,
        timestamp: new Date().toISOString(),
      };

      log.info(`[${traceId}] Worker ${workerId} download ${result.status}: ${result.message || 'success'}`);
      return downloadResult;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`[${traceId}] Worker ${workerId} download failed: ${errorMessage}`);

      return {
        workerId,
        status: 'failed' as const,
        message: errorMessage,
        timestamp: new Date().toISOString(),
      };
    }
  });

  // Wait for all workers to complete
  const workerResults = await Promise.all(workerPromises);
  results.push(...workerResults);

  // Calculate summary
  const successCount = results.filter(r => r.status === 'success').length;
  const failedCount = results.filter(r => r.status === 'failed').length;

  // Determine overall status
  let status: 'completed' | 'partial' | 'failed';
  if (failedCount === 0) {
    status = 'completed';
  } else if (successCount > 0) {
    status = 'partial';
  } else {
    status = 'failed';
  }

  log.info(`[${traceId}] BinaryMulticastWorkflow completed: ${successCount} success, ${failedCount} failed`);

  return {
    traceId,
    status,
    summary: {
      total: workerIds.length,
      success: successCount,
      failed: failedCount,
    },
    results,
  };
}

