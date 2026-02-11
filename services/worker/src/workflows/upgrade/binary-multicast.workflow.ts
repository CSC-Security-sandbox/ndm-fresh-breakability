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
} from '@temporalio/workflow';
import { WorkerDownloadWorkflow } from './worker-download.workflow';
import {
  BinaryMulticastWorkflowInput,
  BinaryMulticastWorkflowOutput,
  WorkerDownloadResult,
} from './upgrade.types';

// =============================================================================
// Logging helper
// =============================================================================

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}

// =============================================================================
// Workflow
// =============================================================================

/**
 * Binary Multicast Workflow
 * 
 * @param input - Workflow input containing workerIds, version, and cpBaseUrl
 * @returns Aggregated results from all workers
 */
export async function BinaryMulticastWorkflow(
  input: BinaryMulticastWorkflowInput
): Promise<BinaryMulticastWorkflowOutput> {
  const { traceId, workerIds, version } = input;

  log(traceId, `BinaryMulticastWorkflow starting for ${workerIds.length} workers, version ${version}`);

  const results: WorkerDownloadResult[] = [];

  // Process all workers in parallel
  // Platform is NOT passed here - each worker detects its own platform at runtime
  const workerPromises = workerIds.map(async (workerId) => {
    const taskQueue = `${workerId}-TaskQueue`;

    log(traceId, `Starting download for worker ${workerId} on queue ${taskQueue}`);

    try {
      const result = await executeChild(WorkerDownloadWorkflow, {
        args: [{
          traceId,
          workerId,
          version,
        }],
        workflowId: `WorkerDownload-${traceId}-${workerId}`,
        taskQueue,
        cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
        parentClosePolicy: ParentClosePolicy.TERMINATE,
      });

      const downloadResult: WorkerDownloadResult = {
        workerId,
        platform: result.platform || 'linux',
        status: result.status,
        message: result.message,
        stagedPath: result.stagedPath,
        timestamp: new Date().toISOString(),
      };

      log(traceId, `Worker ${workerId} download ${result.status}: ${result.message || 'success'}`);
      return downloadResult;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(traceId, `Worker ${workerId} download failed: ${errorMessage}`);

      return {
        workerId,
        platform: 'linux' as const,
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

  log(traceId, `BinaryMulticastWorkflow completed: ${successCount} success, ${failedCount} failed`);

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

