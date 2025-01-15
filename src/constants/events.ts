//  ------- internal events ------------// 
export const enum EmitterEvents{
    CREATE_TASK='task.create',
    NOTIFY_WORKER='worker.message',
    JOB_RUN_STATUS_UPDATE='jobrun.status.update',
    DISCOVERY_COMPLETE='discovery.completed',
    UPDATE_JOB_RUN_MAPPING = 'update.jobrun.worker.mapping',
    IN_ACTIVE_JOB_CONFIG = 'inactivate.jobconfig',
    UNMOUNT_NOTIFICATION = 'worker.unmount.path'
} 


// ------------- Inventory Queue ---------//
export const enum InventoryQueueEvents{
    INVENTORY = 'inventory'
}

export enum InventoryPayloadType {
    DISCOVERY_COMPLETED = 'DISCOVERY_COMPLETED'
} 
