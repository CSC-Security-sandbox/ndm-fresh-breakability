import { proxyActivities } from '@temporalio/workflow';
import { JobServiceJobType } from '../../activities/common/enums';
import { SetupActivityService } from '../../activities/setup-worker/setup.activity.service';
import { SetupWorkerParams } from '../../activities/types/tasks';

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}


const { 
  setup: setupWorkerActivity,
  speedTestSetup: setupSpeedTestWorkerActivity,
} = proxyActivities<SetupActivityService>({ startToCloseTimeout: '300s' });

export async function SetupWorkerWorkflow(
  args: any,
): Promise<SetupOutput> {
  await log( args.traceId,`Starting SetupWorkerWorkflow with args: ${JSON.stringify(args)}`);
  if(args.fileServer?.jobConfig.jobType==JobServiceJobType.SPEED_TEST) {
    const params: SetupWorkerParams = {
      jobRunId: args.jobRunId,
      hostname: args.hostname,
      protocols: args.protocols,
      pathId: args.pathId,
      path: args.path,
      userName: args.username,
      password: args.password,
      protocolType: args.protocolType,
      fileServerId: args.fileServer.fileServer,
      volumeId: args.volumeId,
      tests: args.tests,
    };
    return await setupSpeedTestWorkerActivity(params);
  }else{
      return await setupWorkerActivity(args.jobRunId);
  }

}