//  ------- internal events ------------// 
export const enum EmitterEvents{
    TaskCreate='task.create',
    NotifyWorker='worker.message',
    JobRunStatusUpdate='jobrun.status.update',
    DiscoveryComplete='discovery.completed',
    UpdateJobRunMapping = 'update.jobrun.worker.mapping',
    InActivateJobConfig = 'inactivate.jobconfig'
} 


// ------------- Inventory Queue ---------//
export const enum InventoryQueueEvents{
    INVENTORY = 'inventory'
}

export enum InventoryPayloadType {
    DISCOVERY_COMPLETED = 'DISCOVERY_COMPLETED'
} 
