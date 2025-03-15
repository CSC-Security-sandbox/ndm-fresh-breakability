import { proxyActivities, continueAsNew, ContinueAsNew } from '@temporalio/workflow';
import { DiscoveryActivity } from 'src/activities/discovery/discovery.activities';
import { DiscoveryScanActivity } from 'src/activities/discovery/discovery.core.activity';
import { CommonActivityService } from 'src/activities/common/common.service';
import { JobRunStatus } from 'src/activities/discovery/enums';

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}

const { scanActivity } = proxyActivities<DiscoveryScanActivity>({ startToCloseTimeout: '300s' });

const { 
  fetchTasks: fetchTaskActivity,
  publishTask: publishTaskActivity,
  discoveryStatusUpdate: updateDiscoveryStatus,
} = proxyActivities<DiscoveryActivity>({ startToCloseTimeout: '5h' });

const { 
  updateLastEntry: updateLastEntry,
  getJobState: getJobStateActivity,
  updateStatus: updateStatusActivity,
  setJobState: setJobStateActivity,
} = proxyActivities<CommonActivityService>({ startToCloseTimeout: '5h' });

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
      let tasks = await fetchTaskActivity(traceId);
      if(iteration === 1) {
        log(traceId, `Tasks found in first iteration in DiscoveryJobWorkflow : ${JSON.stringify(tasks)}`);
      }
      log(traceId, `Tasks found: ${tasks.length}`);
      if (!tasks || tasks.length === 0) {
        const jobState = await getJobStateActivity(traceId);
        const uniqueAgreedWorkers = jobState.workers_agreed.includes(workerId) ? jobState.workers_agreed : [...jobState.workers_agreed, workerId];
        const newJobState = { ...jobState, workers_agreed: uniqueAgreedWorkers };
        await setJobStateActivity(traceId, newJobState);
        const isJobCompleted = newJobState.workers_agreed.length === newJobState.workers.length && newJobState.tasks_completed >= newJobState.tasks_total;
        if (isJobCompleted) {
          log(traceId, `No tasks found. sending last entry`);
          await updateLastEntry(traceId);
          await setJobStateActivity(traceId, { ...newJobState, status: JobRunStatus.Completed });
          const finalJobState = await getJobStateActivity(traceId);
          log(traceId, `Discovery completed with finalJobState: ${JSON.stringify(finalJobState)}`);
          return { message: 'Discovery completed' };
        } continue;
      }
      log(traceId, `task found, total -> ${tasks.length}`);
      let isFatalError = false;
      for(const task of tasks) {
        log(traceId, `Starting discovery for task -> ${task.id}`);
        const {isFatalErrored } = await scanActivity({ task });
        if(isFatalErrored) {
          isFatalError = true;
          log(traceId, `Discovery Error for task -> ${task.id}`);
        } else  log(traceId, `Discovery completed for task -> ${task.id}`);
        await publishTaskActivity(traceId);
       
      }
      if(isFatalError) {
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
      throw error; // Let Temporal handle it
    } else {
      await updateDiscoveryStatus(traceId, 'FAILED')
        .then(() => log(traceId, `Discovery status updated to Failed`))
        .then(async () => await updateLastEntry(traceId))
        .catch((err) => log(traceId, `Failed to update discovery status: ${err}`));
      return { message: 'Discovery failed' };
    }
  }
}
