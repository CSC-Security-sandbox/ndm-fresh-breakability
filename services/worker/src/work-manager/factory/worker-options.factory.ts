import { NativeConnection } from "@temporalio/worker";
import { WorkerConfiguration } from "../work-manager.types";

export class WorkFlowOptions {
    identity: string;
    workerId: string;
    connection: NativeConnection;
    taskQueue: string;
    activities: any;
    workflowsPath: any;
    maxConcurrentActivityTaskExecutions: any

    constructor(
        identity: string,
        workerId: string,
        connection: NativeConnection,
        taskQueue: string,
        config: WorkerConfiguration,
        activities: any = undefined,
        maxConcurrentActivityTaskExecutions: any = undefined
    ){
        this.identity = identity;
        this.workerId = workerId;
        this.connection = connection;
        this.taskQueue = !config.dynamicTaskQueue ? taskQueue : `${config.taskQueueId}-${taskQueue}`
        this.activities = activities;
        this.workflowsPath = require.resolve('../../workflows/workflows'),
        this.maxConcurrentActivityTaskExecutions = maxConcurrentActivityTaskExecutions;
    }
}
