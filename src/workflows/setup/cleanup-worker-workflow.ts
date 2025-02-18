import { proxyActivities } from '@temporalio/workflow';
import { SetupActivityService } from 'src/activities/setup-worker/setup.activity.service';

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}

const { 
  cleanup: cleanupWorkerActivity,
} = proxyActivities<SetupActivityService>({ startToCloseTimeout: '300s' });


export async function CleanupWorkerWorkflow(
  args: any,
): Promise<any> {

  log( args.traceId,`Starting CleanupWorkerWorkflow with args: ${JSON.stringify(args)}`);

  return await cleanupWorkerActivity(args.jobRunId);
}
