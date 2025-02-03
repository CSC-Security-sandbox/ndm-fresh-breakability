import { proxyActivities } from '@temporalio/workflow';
import type * as discovery from '../../activities/discovery/discovery';
import type * as fetchTasks from '../../activities/discovery/fetch-tasks';
import * as publishTask from '../../activities/discovery/publish-task';

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}

const { discovery: scanActivity } = proxyActivities<typeof discovery>({
  startToCloseTimeout: '30s',
});
const { fetchTasks: fetchTaskActivity } = proxyActivities<typeof fetchTasks>({
  startToCloseTimeout: '30s',
});

const { publishTask: publishTaskActivity } = proxyActivities<
  typeof publishTask
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
    `Starting DiscoveryWorkerWorkflow with args-->: ${JSON.stringify(args.options)}`,
  );
  let discoveryResponse: any = {};
  try {
    while (true) {
      const tasks: any = await fetchTaskActivity(traceId);
      if (tasks && tasks.length === 0) {
        log(traceId, `No more tasks in the stream. Exiting workflow.`);
        break;
      } else {
        log(traceId, `Tasks fetched from the stream: ${JSON.stringify(tasks)}`);
        for (const task of tasks) {
          discoveryResponse = await scanActivity(
            args.traceId,
            args.options,
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
    }
    console.log(`` + JSON.stringify(discoveryResponse));
    return { message: 'Discovery completed' };
  } catch (error) {
    log(traceId, `Error  occured during discovery : ${error}`);
    return { message: 'Discovery failed'};
   
  }
}
