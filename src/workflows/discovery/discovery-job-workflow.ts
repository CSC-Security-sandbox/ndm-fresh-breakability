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
        await updateLastEntry(traceId)
          .then(() => log(traceId, `Discovery status updated to Completed`))
          .catch((err) => log(traceId, `Failed to update discovery status: ${err}`));
        return { message: 'Discovery Completed' };
      }
      log(traceId, `task found, total -> ${tasks.length}`);
      for(const task of tasks) {
        log(traceId, `Starting discovery for task -> ${task.id}`);
        const scanResult = await scanActivity({ data: task }, traceId);
        log(traceId, `Discovery completed for task -> ${task.id}`);
        if(scanResult && scanResult.numDirs) {
          log(traceId, `Publishing unscanned for task -> ${task.id}`);
          await publishTaskActivity(traceId);
          log(traceId, `Published unscanned for task -> ${task.id}`);
        } else {
          log(traceId, `No unscanned task found for task -> ${task.id}`);
        }
      }
    }
  } catch (error) {
    await updateDiscoveryStatus(traceId, 'FAILED')
      .then(() => log(traceId, `Discovery status updated to Failed`))
      .catch((err) => log(traceId, `Failed to update discovery status: ${err}`));
    return { message: 'Discovery failed' };
  }
}
