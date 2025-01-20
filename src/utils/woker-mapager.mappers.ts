import { WorkerConfiguration } from "src/work-manager/work-manager.types";

export const getWorkerIdentity = (
    config: WorkerConfiguration
): string =>   `${config.workerId}/${config.configName}${config.dynamicTaskQueue ? '-' + config.taskQueueId : ''}`