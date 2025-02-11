import { proxyActivities } from '@temporalio/workflow';

import type * as setupWorker from '../../activities/setup-worker/setup-worker';

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}

const { setup: setupWorkerActivity } = proxyActivities<
  typeof setupWorker
>({
  startToCloseTimeout: '30s',
});

export async function SetupWorkerWorkflow(
  args: any,
): Promise<any> {
  //const fileServer = args.fileServer;

  log(
    args.jobRunId,
    `Starting SaetupWorkerWorkflow with args: ${JSON.stringify(args)}`,
  );

  //setup all the workers first who can run discovery workflow
  const results = await setupWorkerActivity(args.jobRunId);
    // fileServer.protocols.map(async (protocol) => {
    //   return await setupWorkerActivity(args.traceId, protocol.type, {
    //     hostname: fileServer.hostname,
    //     path: args.path,
    //     jobRunId: args.jobRunId,
    //     ...protocol,
    //   });
    // }),
    ; 

  return results;
}
``