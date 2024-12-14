export enum InventoryPayloadType {
    DATA_INSERT = 'DATA_INSERT',
    DISCOVERY_COMPLETED = 'DISCOVERY_COMPLETED'
} 


export interface CreateInventory {
    pathId: string;
    jobRunId: string;
    path: string;
    isFolder: boolean;
    status: string;
    parentPath: string;
    depth: number;
    fileName: string;
    uid: number;
    gid: number;
    size: number;
    blocks: number;
    mtime: string;
    atime: string;
    birthtime: string;
    extension: string;
    permission: string;
}

export interface DiscoveryCompletedPayload {
    jobRunId: string
}


  

export interface InventoryPayload {
    type: InventoryPayloadType
    data: CreateInventory[] | DiscoveryCompletedPayload | any
}