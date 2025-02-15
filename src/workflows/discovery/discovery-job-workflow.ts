import { proxyActivities } from '@temporalio/workflow';
import { DiscoveryActivity } from 'src/activities/discovery/discovery.activities';
import { DiscoveryScanActivity } from 'src/activities/discovery/discovery-scan-activities';


async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}

const { scanActivity: scanActivity } = proxyActivities<DiscoveryScanActivity>({ startToCloseTimeout: '300s' });

const { 
  fetchTasks: fetchTaskActivity,
  publishTask: publishTaskActivity,
  discoveryStatusUpdate: updateDiscoveryStatus,
  publishLastEntry: updateLastEntry
} = proxyActivities<DiscoveryActivity>({ startToCloseTimeout: '300s' });


/**
 * This is parent workflow that will call SetupWorkerWorkflow for each workerId
 * @param traceId Unique identifier to trace the request
 * @param payload Payload containing workerIds and fileServer
 * @param options Options to pass to this workflow and all child workflows
 * @returns Returns the result of all child workflows
 */
export async function DiscoveryJobWorkflow(args: any): Promise<any> {
  const { traceId, options } = args;
  log(traceId, `Starting DiscoveryWorkerWorkflow with args-->: ${JSON.stringify(options)}`);

  try {
    await updateDiscoveryStatus(traceId, 'RUNNING');
    while (true) {
      let tasks = await fetchTaskActivity(traceId);
      if (!tasks || tasks.length === 0) {
        log(traceId, `No tasks found. Checking again to ensure no new tasks were just published...`);
        // Immediately re-fetch tasks to ensure we didn’t miss newly published tasks
        await updateLastEntry(traceId)
          .then(() => log(traceId, `Discovery status updated to Completed`))
          .catch((err) => log(traceId, `Failed to update discovery status: ${err}`));
        return { message: 'Discovery Completed' };
      }

      for(const task of tasks) {
        await scanActivity({data:task}, traceId)
        await publishTaskActivity(traceId)
      }
    }
  } catch (error) {
    await updateDiscoveryStatus(traceId, 'FAILED')
      .then(() => log(traceId, `Discovery status updated to Failed`))
      .catch((err) => log(traceId, `Failed to update discovery status: ${err}`));
    return { message: 'Discovery failed' };
  }
}
