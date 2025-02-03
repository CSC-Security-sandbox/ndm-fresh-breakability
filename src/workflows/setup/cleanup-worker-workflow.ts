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
  const fileServer = args.fileServer;

  log(
    args.traceId,
    `Starting CleanupWorkerWorkflow with args: ${JSON.stringify(fileServer)}`,
  );

  //cleanup all the workers
  const results = await Promise.all(
    fileServer.protocols.map(async (protocol) => {
      return await cleanupWorkerActivity(args.traceId, protocol.type, {
        hostname: fileServer.hostname,
        path: args.path,
        jobRunId: args.jobRunId,
        ...protocol,
      });
    }),
  );

  return results;
}
