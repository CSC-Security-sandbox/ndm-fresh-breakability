import { proxyActivities, continueAsNew, ContinueAsNew } from '@temporalio/workflow';
import { SpeedTestActivities } from '../../activities/speed-test/speed-test-activities';
import { CommonActivityService } from '../../activities/common/common.service';
import { JobRunStatus, TaskStatus } from '../../activities/common/enums';
import { SpeedTestOutput } from '../../activities/speed-test/speed-test.type';


async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}

const { readActivity, writeActivity, networkPerformanceActivity , postResultsActivity} = proxyActivities<SpeedTestActivities>({ startToCloseTimeout: '300s', retry: { maximumAttempts: 3 } });

const { 
  updateStatus: updateStatusActivity,
} = proxyActivities<CommonActivityService>({ 
  startToCloseTimeout: '24h', 
 });

// const { 
//   getJobState: getJobStateActivity,
// } = proxyActivities<CommonActivityService>({ startToCloseTimeout: '5h' });

export async function SpeedTestJobWorkflow(args: any): Promise<any> {
  const { traceId, options, workerId, volumeId, tests } = args;
  log(traceId, `Starting SpeedTestWorkerWorkflow with args-->: ${JSON.stringify(tests)}`);
  
  try {
    await updateStatusActivity({jobRunId:traceId, status :JobRunStatus.Running})
    // const jobState = await getJobStateActivity(traceId);
    // if(jobState.status !== JobRunStatus.Running) {
    //   return { message: `Job status changed to ${jobState.status}` };
    // }
    const data = await postResultsActivity(traceId, workerId, args.fileServerId, null)
    
    let writeResult:SpeedTestOutput, readResult:SpeedTestOutput, networkPerformanceResult: SpeedTestOutput;

    if (tests.writeTest) {
      writeResult = await writeActivity(args, traceId, volumeId, data.writeResultId);
    }
    
    if (tests.readTest) {
      readResult = await readActivity(args, traceId, volumeId, data.readResultId);
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
    await updateStatusActivity({jobRunId:traceId, status :JobRunStatus.Completed})
    log(traceId, 'Speed test completed successfully');

  } catch (error) {
    if (error instanceof ContinueAsNew) {
      log(traceId, `Workflow continued as new: ${error.message}`);
      throw error; 
    } else {
      await updateStatusActivity({jobRunId:traceId, status :JobRunStatus.Failed})
        .then(() => log(traceId, 'Speed test status updated to FAILED'))
        .catch((err) => log(traceId, `Failed to update speed test status: ${err}`));
      log(traceId, `Error occurred: ${error.message}`);
      return { message: 'Speed test failed' };
    }
  }
}