import { proxyActivities } from '@temporalio/workflow';

import type * as setupWorker from '../../activities/setup-worker/setup-worker';

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}

const { cleanup: cleanupWorkerActivity } = proxyActivities<
  typeof setupWorker
>({
  startToCloseTimeout: '30s',
});

export async function CleanupWorkerWorkflow(
  args: any,
): Promise<any> {
  //const fileServer = args.fileServer;

  log(
    args.traceId,
    `Starting CleanupWorkerWorkflow with args: ${JSON.stringify(args)}`,
  );

  //cleanup all the workers
  const results = await cleanupWorkerActivity(args.jobRunId);

  return results;
}
