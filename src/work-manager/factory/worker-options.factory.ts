import { NativeConnection } from "@temporalio/worker";
import { WorkFlowType } from "./worker-options.types";
import { WorkerConfiguration } from "../work-manager.types";

// const workerOptions = {
//     identity: this.getWorkerIdentity(
//       workerId,
//       config.name,
//       config.dynamicTaskQueue,
//       config.taskQueueId,
//     ),
//     workerId: workerId,
//     connection: this.connection,
//     taskQueue: `${workerConfig.getTaskQueue(config.taskQueueId)}`,
//     activities: workerConfig.activities
//       ? workerConfig.activities
//       : null,
//     workflowsPath: workerConfig.workflowsPath,
//   };

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
        this.taskQueue = !config.dynamicTaskQueue ? taskQueue : `${config.taskQueueId}-${this.taskQueue}`
        this.activities = activities;
        this.workflowsPath = require.resolve('../../workflows/workflows')
    }
}

export const WorkerOptionsFactory = (id: string, config: WorkerConfiguration, workerId: string, connection: NativeConnection) => {
    switch (config.configName) {
        case WorkFlowType.PARENT_WORKFLOW:
            return new WorkFlowOptions( id, workerId, connection, 'ParentWorkflow-TaskQueue', config)
        case WorkFlowType.WORKER_SPECIFIC_WORKFLOW:
            return  new WorkFlowOptions( id, workerId, connection, 'TaskQueue', config)
        default:
            return undefined
    }
}