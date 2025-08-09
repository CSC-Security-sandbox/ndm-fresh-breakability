import { Platform, WorkerConfiguration } from "src/work-manager/work-manager.types";



export const getWorkerIdentity = (
    config: WorkerConfiguration
): string =>  `${config.workerId}/${config.configName}${config.dynamicTaskQueue ? '-' + config.taskQueueId : ''}`

export const getPlatform = (platform: NodeJS.Platform): Platform => {

    switch (platform) {
        case 'linux':
            return Platform.LINUX;
        case 'win32':
            return Platform.WINDOWS;
        case 'darwin':
            return Platform.MACOS;
        default:
            return Platform.OTHER;
    }
}