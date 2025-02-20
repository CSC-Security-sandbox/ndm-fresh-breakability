import { proxyActivities, continueAsNew, ContinueAsNew } from '@temporalio/workflow';
import { DiscoveryActivity } from 'src/activities/discovery/discovery.activities';
import { DiscoveryScanActivity } from 'src/activities/discovery/discovery-scan-activities';


async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}

const { scanActivity } = proxyActivities<DiscoveryScanActivity>({ startToCloseTimeout: '300s' });

const { 
  fetchTasks: fetchTaskActivity,
  publishTask: publishTaskActivity,
  discoveryStatusUpdate: updateDiscoveryStatus,
  publishLastEntry: updateLastEntry
} = proxyActivities<DiscoveryActivity>({ startToCloseTimeout: '5h' });

export async function DiscoveryJobWorkflow(args: any): Promise<any> {
  const { traceId, options } = args;
  log(traceId, `Starting DiscoveryWorkerWorkflow with args-->: ${JSON.stringify(options)}`);
  let iteration = 0;
  try {
    await updateDiscoveryStatus(traceId, 'RUNNING');
    while (true) {
      iteration++;
      let tasks = await fetchTaskActivity(traceId);
      if (!tasks || tasks.length === 0) {
        log(traceId, `No tasks found. sending last entry`);
        await updateLastEntry(traceId)
        .then(() => log(traceId, `Discovery status updated to Completed`))
        .catch((err) => log(traceId, `Failed to update discovery status: ${err}`));
        return { message: 'Discovery Completed' };
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
        .catch((err) => log(traceId, `Failed to update discovery status: ${err}`));
      return { message: 'Discovery failed' };
    }
  }
}
