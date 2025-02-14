import { proxyActivities } from '@temporalio/workflow';
import { WorkerService } from 'src/activities/workers/worker.service';

const activities = proxyActivities<WorkerService>({ startToCloseTimeout: '1 minute' });

export const childWorkflow = async (param: any): Promise<string> => await activities.assignTasksToWorkerThread(param, '');