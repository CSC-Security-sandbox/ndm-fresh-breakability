import { proxyActivities } from '@temporalio/workflow';

import type * as validate from '../../activities/validate-connection/validate-connection';

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}

const { validate: validateActivity } = proxyActivities<typeof validate>({
  startToCloseTimeout: '30s',
});

export async function ValidateWorkerConnectionWorkflow(
  args: any,
): Promise<any> {
  const fileServer = args.fileServer;

  log( args.traceId, `Starting ValidateConnectionWorkflow with args: ${JSON.stringify(fileServer)}`);
  const results = await Promise.all(
    fileServer.protocols.map(async (protocol) => {
      return await validateActivity(args.traceId, protocol.type, {
        hostname: fileServer.hostname,
        ...protocol,
      });
    }),
  );
  return results;
}
