import { proxyActivities } from '@temporalio/workflow';

import type { ListPathActivity } from 'src/activities/list-path/list-path.service';

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}


const { listPath: listPathActivity } = proxyActivities<ListPathActivity>({
  startToCloseTimeout: '30s',
});

export async function ListPathWorkerWorkflow(
  args: any,
): Promise<any> {
  const fileServer = args.fileServer;


  log( args.traceId, `Starting ListPathWorkerWorkflow with args: ${JSON.stringify(fileServer)}`);
  console.log(`listPathActivity`)
  const results = await Promise.all(
    fileServer.protocols.map(async (protocol) => {
      return await listPathActivity(args.traceId, protocol.type, {
        hostname: fileServer.hostname,
        serverType: fileServer.serverType,
        useStorageAPI: fileServer.useStorageAPI,
        storageApiCredentials: fileServer.storageApiCredentials,
        ...protocol,
      });
    }),
  );
  return results;
}
