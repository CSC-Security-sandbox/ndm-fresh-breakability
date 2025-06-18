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
  log( args.traceId, `Starting ValidateWorkerConnectionWorkflow with args: ${JSON.stringify(args)}`);
  const results = await Promise.all(
    fileServer.protocols.map(async (protocol) => {
      const res = await validateActivity(args.traceId, protocol.type, {
          hostname: fileServer.hostname,
          ...protocol,
        },
        args.feature
      );
      console.log('result of await ',res)
      return res;
    }),
  );
  //console.log('resukt ibs the workflorrrrr', JSON.stringify(results) )
  return results;
}
