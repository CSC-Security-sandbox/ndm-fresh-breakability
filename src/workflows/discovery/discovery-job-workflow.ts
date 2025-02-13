import { proxyActivities } from '@temporalio/workflow';
import type * as discovery from '../../activities/discovery/discovery';
import type * as discoveryProcess from '../../activities/discovery/worker.manager'
import type * as fetchTasks from '../../activities/discovery/fetch-tasks';
import * as publishTask from '../../activities/discovery/publish-task';
import * as discoveryStatusUpdate from '../../activities/discovery/discovery-status-update';

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}

const { discovery: scanActivity } = proxyActivities<typeof discovery>({
  startToCloseTimeout: '300s',
});

const { discoveryProcess: discoveryActivity } = proxyActivities<typeof discoveryProcess>({
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
  log(args.traceId, `Starting DiscoveryWorkerWorkflow with args-->: ${JSON.stringify(args.options)}`);
  try {
    while (true) {
      const tasks = await fetchTaskActivity(traceId);
      if (!tasks || tasks.length === 0) {
        await updateDiscoveryStatus(traceId, 'COMPLETED')
          .then(() => log(traceId, `Discovery status updated to Completed`))
          .catch((err) => log(traceId, `Failed to update discovery status: ${err}`));
        return { message: 'Discovery Completed' };
      }
      for (const task of tasks) {
        await discoveryActivity({ data: {
          id: args.traceId,
          jobRunId: task.jobRunId,
          taskType: '',
          status: 'PENDING',
          workerId: task.workerId,
          sPath: task.sPath,
          tPath: task.tPath,
          excludeFilePatterns: task.excludeFilePatterns,
          commands: task.commands
        }}, args.traceId);
        // await scanActivity(
        //   args.traceId,
        //   args?.options,
        //   task,
        // );
        await publishTaskActivity(traceId);
      }
    }
  } catch (error) {
    await updateDiscoveryStatus(traceId, 'FAILED')
      .then(() => log(traceId, `Discovery status updated to Completed`))
      .catch((err) => log(traceId, `Failed to update discovery status: ${err}`));
    return { message: 'Discovery failed' };
  }
}
