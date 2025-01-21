import { NativeConnection } from "@temporalio/worker";
import { WorkFlowType } from "./worker-options.types";
import { WorkerConfiguration } from "../work-manager.types";
import * as activities from '../../activities/activities';

class WorkFlowOptions {
    identity: string;
    workerId: string;
    connection: NativeConnection;
    taskQueue: string;
    activities: any;
    workflowsPath: any;

    constructor(
        identity: string,
        workerId: string,
        connection: NativeConnection,
        taskQueue: string,
        config: WorkerConfiguration,
        activities: any = undefined,
    ){
        this.identity = identity;
        this.workerId = workerId;
        this.connection = connection;
        this.taskQueue = !config.dynamicTaskQueue ? taskQueue : `${config.taskQueueId}-${taskQueue}`
        this.activities = activities;
        this.workflowsPath = require.resolve('../../workflows/workflows')

        console.log(this.taskQueue)
    }
}

export const WorkerOptionsFactory = (id: string, config: WorkerConfiguration, workerId: string, connection: NativeConnection) => {
    switch (config.configName) {
        case WorkFlowType.PARENT_WORKFLOW:
            return new WorkFlowOptions( id, workerId, connection, 'ParentWorkflow-TaskQueue', config)
        case WorkFlowType.WORKER_SPECIFIC_WORKFLOW:
            return  new WorkFlowOptions( id, workerId, connection, 'TaskQueue', config, activities)
        default:
            return undefined
    }
}