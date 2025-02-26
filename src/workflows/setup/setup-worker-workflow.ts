import { proxyActivities } from '@temporalio/workflow';
import { SetupActivityService } from 'src/activities/setup-worker/setup.activity.service';

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}


const { 
  setup: setupWorkerActivity,
} = proxyActivities<SetupActivityService>({ startToCloseTimeout: '300s' });

export async function SetupWorkerWorkflow(
  args: any,
): Promise<any> {
  try {
    log(args.jobRunId, `Starting SetupWorkerWorkflow with args: ${JSON.stringify(args)}`);
  return await setupWorkerActivity(args.jobRunId);
  } catch (error) {
    log(args.jobRunId, `Failed to setup worker: ${error}`);
    throw error;
  }
}