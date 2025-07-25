import { proxyActivities } from '@temporalio/workflow';
import type { ValidateConnectionActivity } from '../../activities/validate-connection/validate-connection.service';

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}

const { validate: validateActivity } = proxyActivities<ValidateConnectionActivity>({
  startToCloseTimeout: '300s',
});

export async function ValidateWorkerConnectionWorkflow(
  args: any,
): Promise<any> {
  const fileServer = args.fileServer;
  const results = await Promise.all(
    fileServer.protocols.map(async (protocol) => {
      return await validateActivity(args.traceId, protocol.type, {
        hostname: fileServer.hostname,
        ...protocol,
      },
      args.feature
      );
    }),
  );
  return results;
}
