import { proxyActivities } from '@temporalio/workflow';
import { SetupActivityService } from 'src/activities/setup-worker/setup.activity.service';

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}

const { 
  cleanup: cleanupWorkerActivity,
  speedTestCleanup: cleanupSpeedTestWorkerActivity,
} = proxyActivities<SetupActivityService>({ startToCloseTimeout: '300s' });


export async function CleanupWorkerWorkflow(
  args: any,
): Promise<any> {
    await log( args.traceId,`Starting CleanupWorkerWorkflow with args: ${JSON.stringify(args)}`);
    if(args.jobType=="SPEED_TEST") {
      return await cleanupSpeedTestWorkerActivity(args.jobRunId, args.fsDetails, args.protocolType);
    }
    else{
     return await cleanupWorkerActivity(args.jobRunId);
    }
}
