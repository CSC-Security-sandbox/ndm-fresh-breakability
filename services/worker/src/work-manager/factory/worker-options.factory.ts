import { NativeConnection } from "@temporalio/worker";
import { WorkerConfiguration } from "../work-manager.types";

export class WorkFlowOptions {
    identity: string;
    workerId: string;
    connection: NativeConnection;
    taskQueue: string;
    activities: any;
    workflowsPath: any;
    maxConcurrentActivityTaskExecutions: any;
    shutdownForceTime: any;
    maxCachedWorkflows: number;
    stickyQueueScheduleToStartTimeout: string;
    maxConcurrentActivityTaskPollers: number;

    constructor(
        identity: string,
        workerId: string,
        connection: NativeConnection,
        taskQueue: string,
        config: WorkerConfiguration,
        activities: any = undefined,
        maxConcurrentActivityTaskExecutions: any = undefined,
        shutdownForceTime: string= '30s',
        maxConcurrentActivityTaskPollers: number = 2,
    ){
        this.identity = identity;
        this.workerId = workerId;
        this.connection = connection;
        this.taskQueue = !config.dynamicTaskQueue ? taskQueue : `${config.taskQueueId}-${taskQueue}`
        this.activities = activities;
        this.workflowsPath = require.resolve('../../workflows/workflows'),
        this.maxConcurrentActivityTaskExecutions = maxConcurrentActivityTaskExecutions;
        this.shutdownForceTime = shutdownForceTime;
        // Cache tuning: keep active workflows sticky to avoid expensive history replays
        this.maxCachedWorkflows = 50;
        // Allow more time before falling back to non-sticky queue (avoids full replay for long-running workflows)
        this.stickyQueueScheduleToStartTimeout = '30s';
        // Pollers: configurable via env var, auto-calculated as ~25% of executors if not set
        this.maxConcurrentActivityTaskPollers = maxConcurrentActivityTaskPollers;
    }
}
