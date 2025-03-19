import { proxyActivities, continueAsNew, ContinueAsNew } from '@temporalio/workflow';
import { DiscoveryActivity } from 'src/activities/discovery/discovery.activities';
import { DiscoveryScanActivity } from 'src/activities/discovery/discovery.core.activity';
import { CommonActivityService } from 'src/activities/common/common.service';
import { JobRunStatus } from 'src/activities/discovery/enums';

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}

const { scanActivity } = proxyActivities<DiscoveryScanActivity>({ 
  startToCloseTimeout: '24h', 
});

const { 
  fetchTasks: fetchTaskActivity,
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
  const { traceId, options, workerId } = args;
  log(traceId, `Starting DiscoveryWorkerWorkflow with args-->: ${JSON.stringify(args)}`);
  let iteration = 0;
  try {
    await updateStatusActivity({jobRunId:traceId, status :JobRunStatus.Running})
    while (true) {
      iteration++;
      
      const jobState = await getJobStateActivity(traceId);
      if(jobState.status !== JobRunStatus.Running) {
        return { message: `Job status changed to ${jobState.status}` };
      }

      const {isFatalErrored, noTaskFound  } = await scanActivity({ jobRunId: traceId });

      await publishTaskActivity(traceId);

      if (noTaskFound) {
        const jobState = await getJobStateActivity(traceId);
        log(traceId, `No tasks found. total -> ${jobState.tasks_total}, completed -> ${jobState.tasks_completed}`);
        const uniqueAgreedWorkers = jobState.workers_agreed.includes(workerId) ? jobState.workers_agreed : [...jobState.workers_agreed, workerId];
        log(traceId, `Agreed workers: ${uniqueAgreedWorkers}`);
        const newJobState = { ...jobState, workers_agreed: uniqueAgreedWorkers };
        log(traceId, `Updating job state with agreed workers: ${JSON.stringify(newJobState)}`);
        await setJobStateActivity(traceId, newJobState);
        const isJobCompleted = newJobState.workers_agreed.length === newJobState.workers.length;
        if (!isJobCompleted) continue;
        log(traceId, `No tasks found. sending last entry`);
        await updateLastEntry(traceId);
        await setJobStateActivity(traceId, { ...newJobState, status: JobRunStatus.Completed });
        return { message: 'Discovery completed' };
      }

   
       
      if(isFatalErrored) {
        log(traceId, `Fatal Error Occurred On worker ${workerId}`)
        const updatedJobState = {...jobState, failedWorkers: [...jobState.failedWorkers, workerId]}
        await setJobStateActivity(traceId, updatedJobState);
        break
      }

      if(iteration >= 80) {
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
