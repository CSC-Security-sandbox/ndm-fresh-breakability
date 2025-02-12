import { proxyActivities } from '@temporalio/workflow';
import type { ValidateConnectionService } from '../../activities/validate-connection/validate-connection';

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}

const { validate: validateActivity } = proxyActivities<ValidateConnectionService>({
  startToCloseTimeout: '30s',
});

export async function ValidateWorkerConnectionWorkflow(
  args: any,
): Promise<any> {
  const fileServer = args.fileServer;
  log( args.traceId, `Starting ValidateWorkerConnectionWorkflow with args: ${JSON.stringify(args)}`);
  log( args.traceId, `${JSON.stringify(validateActivity) } ${typeof validateActivity}`)
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
