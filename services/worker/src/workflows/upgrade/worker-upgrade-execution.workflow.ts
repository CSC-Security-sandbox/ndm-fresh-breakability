/**
 * Worker Upgrade Execution Workflow (Child)
 *
 * Runs ON the worker machine. Calls the executeUpgrade activity which
 * spawns upgrade.sh / upgrade.ps1 as a detached process and returns immediately.
 *
 * The upgrade script will stop/restart the worker service, killing this workflow's
 * host process. The ABANDONED parent close policy ensures the parent doesn't fail.
 * Completion tracking happens via the UPGRADED flag → bootstrap ACK path.
 */

import { proxyActivities, log } from '@temporalio/workflow';
import type { UpgradeActivityService } from '../../activities/upgrade/upgrade.activity.service';
import {
  WorkerUpgradeExecutionWorkflowInput,
  WorkerUpgradeExecutionWorkflowOutput,
} from './upgrade.types';

const { executeUpgrade } = proxyActivities<Pick<UpgradeActivityService, 'executeUpgrade'>>({
  startToCloseTimeout: '2m',
  retry: { maximumAttempts: 1 },
});

export async function WorkerUpgradeExecutionWorkflow(
  input: WorkerUpgradeExecutionWorkflowInput,
): Promise<WorkerUpgradeExecutionWorkflowOutput> {
  const { traceId, bundleId, workerId, version } = input;

  log.info(`[${traceId}] WorkerUpgradeExecutionWorkflow starting on ${workerId} for version ${version}, bundle ${bundleId}`);

  try {
    const result = await executeUpgrade({ bundleId, version });

    log.info(`[${traceId}] Upgrade script ${result.status} on ${workerId}: ${result.message || ''}`);

    return {
      workerId,
      status: result.status,
      message: result.message,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error(`[${traceId}] executeUpgrade failed on ${workerId}: ${msg}`);
    return {
      workerId,
      status: 'failed',
      message: msg,
    };
  }
}
