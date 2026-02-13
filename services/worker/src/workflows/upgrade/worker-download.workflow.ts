/**
 * Worker Download Workflow
 * 
 * Child workflow that runs ON the worker machine.
 * Downloads the upgrade bundle from CP and stages it locally.
 * 
 * The bundle is a single archive per platform containing:
 *   - Binary (datamigrator-worker-{version}[.exe])
 *   - Env file (worker-{version}.env)
 *   - Checksums (checksums.sha256)
 * 
 * Flow:
 *   BinaryMulticastWorkflow (Parent)
 *       │
 *       │ executeChild(WorkerDownloadWorkflow, { taskQueue: '{workerId}-TaskQueue' })
 *       │
 *       ▼
 *   WorkerDownloadWorkflow (this workflow, runs on worker)
 *       │
 *       │ proxyActivities → downloadBundle(), ackUpgrade()
 *       │
 *       ▼
 *   Binary + Env staged to /opt/datamigrator/staging/{version}/ (or C:\datamigrator\staging\{version}\)
 * 
 */

import { proxyActivities, log } from '@temporalio/workflow';
import type { UpgradeActivityService } from '../../activities/upgrade/upgrade.activity.service';
import {
  WorkerDownloadWorkflowInput,
  WorkerDownloadWorkflowOutput,
} from './upgrade.types';

// =============================================================================
// Activity proxies (run on the worker machine)
//
// Each activity has its own retry/timeout config suited to its nature.
// No maximumAttempts = unlimited retries until timeout expires.
// =============================================================================

// Quick local file check — fail fast
const { isBinaryStaged } = proxyActivities<UpgradeActivityService>({
  startToCloseTimeout: '30s',
  retry: {
    initialInterval: '2s',
    backoffCoefficient: 2.0,
    maximumInterval: '10s',
  },
});
// TODO: consider the start to close timeout
// Bundle download (binary + env + checksums in one archive) — long timeout, heartbeats
const { downloadBundle } = proxyActivities<UpgradeActivityService>({
  startToCloseTimeout: '30m',
  heartbeatTimeout: '2m',
  retry: {
    initialInterval: '10s',
    backoffCoefficient: 2.0,
    maximumInterval: '2m',
  },
});

// Ack to CP — quick HTTP POST
const { ackUpgrade } = proxyActivities<UpgradeActivityService>({
  startToCloseTimeout: '30s',
  retry: {
    initialInterval: '5s',
    backoffCoefficient: 2.0,
    maximumInterval: '30s',
  },
});

// =============================================================================
// Workflow
// =============================================================================

export async function WorkerDownloadWorkflow(
  input: WorkerDownloadWorkflowInput
): Promise<WorkerDownloadWorkflowOutput> {
  const { traceId, workerId, version } = input;

  log.info(`[${traceId}] WorkerDownloadWorkflow starting for worker ${workerId}`);

  try {
    // 1. Check if binary is already staged
    const alreadyStaged = await isBinaryStaged(version);
    if (alreadyStaged) {
      log.info(`[${traceId}] Bundle already staged for version ${version}, skipping download`);
      return {
        workerId,
        status: 'success',
        message: 'Bundle already staged',
      };
    }

    // 2. Download bundle from CP (binary + env + checksums in one archive)
    log.info(`[${traceId}] Downloading bundle for version ${version}`);
    const result = await downloadBundle({ version });
    log.info(`[${traceId}] Bundle staged: ${result.stagedPath} (${result.sizeBytes} bytes, ${result.platform})`);

    // 3. Acknowledge successful download to CP
    log.info(`[${traceId}] Sending ack to CP for successful download`);
    await ackUpgrade({ version, status: 'success' });

    log.info(`[${traceId}] WorkerDownloadWorkflow completed successfully`);
    return {
      workerId,
      platform: result.platform,
      status: 'success',
      stagedPath: result.stagedPath,
      sizeBytes: result.sizeBytes,
      message: `Bundle downloaded and staged successfully`,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`[${traceId}] WorkerDownloadWorkflow failed: ${errorMessage}`);

    // Send failure ack (best effort)
    try {
      await ackUpgrade({ version, status: 'failed', message: errorMessage });
    } catch { /* ignore ack failure */ }
    
    return {
      workerId,
      status: 'failed',
      message: errorMessage,
    };
  }
}
