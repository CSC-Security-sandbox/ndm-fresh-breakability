import { proxyActivities } from '@temporalio/workflow';
import { SetupActivityService } from 'src/activities/setup-worker/setup.activity';

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}



const { 
  setup: setupWorkerActivity,
} = proxyActivities<SetupActivityService>({ startToCloseTimeout: '300s' });

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