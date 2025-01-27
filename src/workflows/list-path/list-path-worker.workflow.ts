import { proxyActivities } from '@temporalio/workflow';

import type * as listPath from '../../activities/list-path/list-path';

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}


const { listPath: listPathActivity } = proxyActivities<typeof listPath>({
  startToCloseTimeout: '30s',
});

export async function ListPathWorkerWorkflow(
  args: any,
): Promise<any> {
  const fileServer = args.fileServer;


  log( args.traceId, `Starting ListPathWorkerWorkflow with args: ${JSON.stringify(fileServer)}`);
  const results = await Promise.all(
    fileServer.protocols.map(async (protocol) => {
      return await listPathActivity(args.traceId, protocol.type, {
        hostname: fileServer.hostname,
        ...protocol,
      });
    }),
  );
  return results;
}
