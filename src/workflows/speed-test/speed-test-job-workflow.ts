import { proxyActivities, continueAsNew, ContinueAsNew } from '@temporalio/workflow';
import { SpeedTestActivity } from 'src/activities/speed-test/speed-test.activities';
import { SpeedTestReadActivity } from 'src/activities/speed-test/speed-test-read-activities';
import { CommonActivityService } from 'src/activities/common/common.service';
import { JobRunStatus } from 'src/activities/discovery/enums';
import { SpeedTestOutput } from 'src/activities/speed-test/speed-test.type';

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}

const { readActivity, writeActivity, networkPerformanceActivity , postResultsActivity} = proxyActivities<SpeedTestReadActivity>({ startToCloseTimeout: '300s' });

const {speedTestStatusUpdate: updateSpeedTestStatus} = proxyActivities<SpeedTestActivity>({ startToCloseTimeout: '5h' });


const { 
  getJobState: getJobStateActivity,
} = proxyActivities<CommonActivityService>({ startToCloseTimeout: '5h' });

export async function SpeedTestJobWorkflow(args: any): Promise<any> {
  const { traceId, options, workerId, volumeId, tests } = args;
  log(traceId, `Starting SpeedTestWorkerWorkflow with args-->: ${JSON.stringify(tests)}`);
  
  try {
    await updateSpeedTestStatus(traceId, 'RUNNING');
    const jobState = await getJobStateActivity(traceId);
    if(jobState.status !== JobRunStatus.Running) {
      return { message: `Job status changed to ${jobState.status}` };
    }

    let writeResult:SpeedTestOutput, readResult:SpeedTestOutput, networkPerformanceResult: SpeedTestOutput;

    if (tests.writeTest) {
      writeResult = await writeActivity(args, traceId, volumeId);
    }
    
    if (tests.readTest) {
      readResult = await readActivity(args, traceId, volumeId);
    }
    
    if (tests.networkPerformance) {
      networkPerformanceResult = await networkPerformanceActivity(args, traceId);
    }

    const results = {
      writeResult,
      readResult,
      networkPerformanceResult
    };

    await postResultsActivity(traceId, workerId, args.fileServerId, results);
    await updateSpeedTestStatus(traceId, 'COMPLETED');
    log(traceId, 'Speed test completed successfully');

  } catch (error) {
    if (error instanceof ContinueAsNew) {
      log(traceId, `Workflow continued as new: ${error.message}`);
      throw error; 
    } else {
      await updateSpeedTestStatus(traceId, 'FAILED')
        .then(() => log(traceId, 'Speed test status updated to FAILED'))
        .catch((err) => log(traceId, `Failed to update speed test status: ${err}`));
      log(traceId, `Error occurred: ${error.message}`);
      return { message: 'Speed test failed' };
    }
  }
}