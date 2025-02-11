import { proxyActivities } from '@temporalio/workflow';
import type * as discovery from '../../activities/discovery/discovery';
import type * as fetchTasks from '../../activities/discovery/fetch-tasks';
import * as publishTask from '../../activities/discovery/publish-task';
import * as discoveryStatusUpdate from '../../activities/discovery/discovery-status-update';

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}

const { discovery: scanActivity } = proxyActivities<typeof discovery>({
  startToCloseTimeout: '300s',
});
const { fetchTasks: fetchTaskActivity } = proxyActivities<typeof fetchTasks>({
  startToCloseTimeout: '300s',
});

const { publishTask: publishTaskActivity } = proxyActivities<
  typeof publishTask
>({
  startToCloseTimeout: '300s',
});

const { discoveryStatusUpdate: updateDiscoveryStatus } = proxyActivities<
  typeof discoveryStatusUpdate
>({
  startToCloseTimeout: '30s',
});

/**
 * This is parent workflow that will call SetupWorkerWorkflow for each workerId
 * @param traceId Unique identifier to trace the request
 * @param payload Payload containing workerIds and fileServer
 * @param options Options to pass to this workflow and all child workflows
 * @returns Returns the result of all child workflows
 */
export async function DiscoveryJobWorkflow(args: any): Promise<any> {
  const { traceId, options } = args;
  log(
    args.traceId,
    `Starting DiscoveryWorkerWorkflow with args: ${JSON.stringify(args.options)}`,
  );

  let discoveryResponse: any = {};
  try {
    while (true) {
      const tasks = await fetchTaskActivity(traceId);
      console.log(`Tasks fetched`);
      if (!tasks || tasks.length === 0) {
        log(traceId, `No more tasks in the stream. Exiting workflow.`);
        await updateDiscoveryStatus(traceId, 'COMPLETED')
          .then(() => {
            log(traceId, `Discovery status updated to Completed`);
          })
          .catch((err) => {
            log(traceId, `Failed to update discovery status: ${err}`);
          });
        return { message: 'Discovery Completed' };
      }

      for (const task of tasks) {
        const discoveryResponse = await scanActivity(
          args.traceId,
          args?.options,
          task,
        );

        log(
          traceId,
          `Discovery findings: ${JSON.stringify(discoveryResponse)}`,
        );

        if (discoveryResponse && discoveryResponse.numDirs > 0) {
          await publishTaskActivity(traceId);
        }
      }
    }
  } catch (error) {
    log(traceId, `Error  occured during discovery : ${error}`);
    await updateDiscoveryStatus(traceId, 'FAILED')
      .then(() => {
        log(traceId, `Discovery status updated to Completed`);
      })
      .catch((err) => {
        log(traceId, `Failed to update discovery status: ${err}`);
      });
    log(traceId, `Discovery status updated to Completed`);
    return { message: 'Discovery failed' };
  }
}
