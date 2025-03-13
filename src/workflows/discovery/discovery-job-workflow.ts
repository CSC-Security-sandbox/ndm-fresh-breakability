import { proxyActivities, continueAsNew, ContinueAsNew } from '@temporalio/workflow';
import { DiscoveryActivity } from 'src/activities/discovery/discovery.activities';
import { DiscoveryScanActivity } from 'src/activities/discovery/discovery-scan-activities';
import { CommonActivityService } from 'src/activities/common/common.service';

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
  getJobState,
  setJobState,
} = proxyActivities<CommonActivityService>({ startToCloseTimeout: '5h' });

export async function DiscoveryJobWorkflow(args: any): Promise<any> {
  const { traceId, options, workerId } = args;
  log(traceId, `Starting DiscoveryWorkerWorkflow with args-->: ${JSON.stringify(args)}`);
  let iteration = 0;
  try {
    await updateDiscoveryStatus(traceId, 'RUNNING');
    while (true) {
      iteration++;
      const jobState = await getJobState(traceId);
      if(jobState.status !== 'RUNNING') {
        return { message: `Job status changed to ${jobState.status}` };
      }
      let tasks = await fetchTaskActivity(traceId);
      if(iteration === 1) {
        log(traceId, `Tasks found in first iteration in DiscoveryJobWorkflow : ${JSON.stringify(tasks)}`);
      }
      log(traceId, `Tasks found: ${tasks.length}`);
      if (!tasks || tasks.length === 0) {
        const jobState = await getJobState(traceId);
        const uniqueAgreedWorkers = jobState.workers_agreed.includes(workerId) ? jobState.workers_agreed : [...jobState.workers_agreed, workerId];
        const newJobState = { ...jobState, workers_agreed: uniqueAgreedWorkers };
        await setJobState(traceId, newJobState);
        const isJobCompleted = newJobState.workers_agreed.length === newJobState.workers.length && newJobState.tasks_completed >= newJobState.tasks_total;
        if (isJobCompleted) {
          log(traceId, `No tasks found. sending last entry`);
          await updateLastEntry(traceId);
          await setJobState(traceId, { ...newJobState, status: 'COMPLETED' });
          const finalJobState = await getJobState(traceId);
          log(traceId, `Discovery completed with finalJobState: ${JSON.stringify(finalJobState)}`);
          return { message: 'Discovery completed' };
        } continue;
      }
      log(traceId, `task found, total -> ${tasks.length}`);
      for(const task of tasks) {
        log(traceId, `Starting discovery for task -> ${task.id}`);
        await scanActivity({ data: task }, traceId);
        await publishTaskActivity(traceId);
        log(traceId, `Discovery completed for task -> ${task.id}`);
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
