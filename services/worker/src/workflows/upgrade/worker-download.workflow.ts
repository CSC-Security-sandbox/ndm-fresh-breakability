/**
 * Worker Download Workflow
 * 
 * Child workflow that runs ON the worker machine.
 * Downloads the binary from CP and stages it locally.
 * 
 * This workflow is spawned by BinaryMulticastWorkflow and runs on:
 * - Task queue: {workerId}-TaskQueue (worker-specific)
 * 
 * Flow:
 *   BinaryMulticastWorkflow (Parent)
 *       │
 *       │ executeChild(WorkerDownloadWorkflow, { taskQueue: '{workerId}-TaskQueue' })
 *       │
 *       ▼
 *   WorkerDownloadWorkflow (this workflow, runs on worker)
 *       │
 *       │ proxyActivities → downloadBinary()
 *       │
 *       ▼
 *   Binary saved to /opt/datamigrator/staging/ (or C:\datamigrator\staging\)
 */

import { proxyActivities } from '@temporalio/workflow';
import type { UpgradeActivityService } from '../../activities/upgrade/upgrade.activity.service';
import {
  WorkerDownloadWorkflowInput,
  WorkerDownloadWorkflowOutput,
} from './upgrade.types';

// =============================================================================
// Logging helper
// =============================================================================

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}

// =============================================================================
// Activity proxies (run on the worker machine)
// =============================================================================

const {
  ensureStagingDir,
  downloadBinary,
  isBinaryStaged,
  getAuthToken,
} = proxyActivities<UpgradeActivityService>({
  startToCloseTimeout: '30m', // Large binary download can take time
  heartbeatTimeout: '2m',
  retry: {
    maximumAttempts: 3,
    initialInterval: '10s',
    backoffCoefficient: 2.0,
  },
});

// =============================================================================
// Workflow
// =============================================================================

export async function WorkerDownloadWorkflow(
  input: WorkerDownloadWorkflowInput
): Promise<WorkerDownloadWorkflowOutput> {
  const { traceId, workerId, platform, downloadUrl, version } = input;

  log(traceId, `WorkerDownloadWorkflow starting for worker ${workerId} (${platform})`);

  try {
    // 1. Check if binary is already staged
    const alreadyStaged = await isBinaryStaged(platform, version);
    if (alreadyStaged) {
      log(traceId, `Binary already staged for version ${version}, skipping download`);
      return {
        workerId,
        status: 'success',
        message: 'Binary already staged',
      };
    }

    // 2. Ensure staging directory exists
    const stagingDir = await ensureStagingDir(platform);
    log(traceId, `Staging directory ready: ${stagingDir}`);

    // 3. Get authentication token for CP API
    log(traceId, `Getting authentication token`);
    const authToken = await getAuthToken();
    if (!authToken) {
      throw new Error('Failed to obtain authentication token');
    }
    log(traceId, `Authentication token obtained`);

    // 4. Download binary from CP
    log(traceId, `Downloading binary from ${downloadUrl}`);
    const downloadResult = await downloadBinary({
      downloadUrl,
      platform,
      version,
      authToken,
    });
    log(traceId, `Binary downloaded: ${downloadResult.downloadedPath} (${downloadResult.sizeBytes} bytes)`);

    // 5. Return success
    log(traceId, `WorkerDownloadWorkflow completed successfully`);
    return {
      workerId,
      status: 'success',
      stagedPath: downloadResult.downloadedPath,
      sizeBytes: downloadResult.sizeBytes,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(traceId, `WorkerDownloadWorkflow failed: ${errorMessage}`);
    
    return {
      workerId,
      status: 'failed',
      message: errorMessage,
    };
  }
}
