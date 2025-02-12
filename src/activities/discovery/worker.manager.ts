import { workerManager } from '../workers/worker.service';
import { DiscoveryPayload } from '../types/tasks';

export async function discoveryProcess(payload: DiscoveryPayload, traceId: string): Promise<string> {
    return await workerManager.assignTasksToWorkerThread(payload, traceId);
}