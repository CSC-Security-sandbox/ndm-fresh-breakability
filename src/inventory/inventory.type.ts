export enum InventoryPayloadType {
    DATA_INSERT = 'DATA_INSERT',
    DISCOVERY_COMPLETED = 'DISCOVERY_COMPLETED'
} 


export interface CreateInventory {
    path: string;
    isDirectory: boolean;
    sourceChecksum: string;
    targetChecksum: string;
    parentPath: string;
    depth: number;
    fileName: string;
    uid: string;
    gid: string;
    fileSize: bigint,
    fileType: string;
    modifiedTime: string;
    accessTime: string;
    filePermission: string;
    fileServerPathId: string;
    jobRunId: string;
    birthTime:string
}

export interface DiscoveryCompletedPayload {
    jobRunId: string
}



export interface InventoryPayload {
    type: InventoryPayloadType
    data: CreateInventory[] | DiscoveryCompletedPayload | any
}