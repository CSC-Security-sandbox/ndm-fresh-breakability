import { continueAsNew, ContinueAsNew, proxyActivities } from '@temporalio/workflow';
import { CommonActivityService } from 'src/activities/common/common.service';
import { DiscoveryActivity } from 'src/activities/discovery/discovery.activities';
import { DiscoveryScanActivity } from 'src/activities/discovery/discovery.core.activity';
import { JobRunStatus } from 'src/activities/discovery/enums';

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}

const { scanActivity } = proxyActivities<DiscoveryScanActivity>({ 
  startToCloseTimeout: '24h', 
});

const { 
  publishTask: publishTaskActivity,
  discoveryStatusUpdate: updateDiscoveryStatus,
} = proxyActivities<DiscoveryActivity>({ 
  startToCloseTimeout: '24h', 
 });

const { 
  updateLastEntry: updateLastEntry,
  getJobState: getJobStateActivity,
  updateStatus: updateStatusActivity,
  setJobState: setJobStateActivity,
} = proxyActivities<CommonActivityService>({ 
  startToCloseTimeout: '24h', 
 });

export async function DiscoveryJobWorkflow(args: any): Promise<any> {
  const { traceId, options } = args;
  let iteration = 0;
  try {
    await updateStatusActivity({jobRunId:traceId, status :JobRunStatus.Running})
    const jobState = await getJobStateActivity(traceId)
    const updatedJobState = {...jobState, status: JobRunStatus.Running};
    await setJobStateActivity(traceId, updatedJobState)
    while (true) {
      iteration++;
      const jobState = await getJobStateActivity(traceId);
      
      const outputs = await Promise.all(
        jobState.workers_agreed.map(async() => { return await scanActivity({ jobRunId: traceId })})
      );

      const noTaskFound = outputs.every((output) => output.noTaskFound);
      const isFatalErrored = outputs.every((output) => output.isFatalErrored);
      
      await Promise.all(
        jobState.workers_agreed.map(() => publishTaskActivity(traceId))
      );
      
      if (noTaskFound) {
        log(traceId, `No tasks found. sending last entry`);
        await updateLastEntry(traceId);
        const currentJobState = await getJobStateActivity(traceId);
        await setJobStateActivity(traceId, { ...currentJobState, status: JobRunStatus.Completed });
        return { message: 'Discovery completed' };
      }

      if(isFatalErrored) {
        log(traceId, `Fatal Error Occurred for all active workers for jobRun Id: ${traceId}`);
        const currentJobState = await getJobStateActivity(traceId);
        const updatedJobState = {...currentJobState, status: JobRunStatus.Errored};
        await setJobStateActivity(traceId, updatedJobState);
        return { message: 'Sync Errored' };
        break
      }

      if(iteration >= 100) {
        log(traceId, `Iteration limit reached. Continuing as new...`);
        await continueAsNew({ traceId, options });
      }

    }
  } catch (error) {
    if (error instanceof ContinueAsNew) {
      log(traceId, `Workflow continued as new: ${error.message}`);
      throw error; 
    } else {
      await updateDiscoveryStatus(traceId, 'FAILED')
        .then(() => log(traceId, `Discovery status updated to Failed`))
        .then(async () => await updateLastEntry(traceId))
        .catch((err) => log(traceId, `Failed to update discovery status: ${err}`));
      return { message: 'Discovery failed' };
    }
  }
}
