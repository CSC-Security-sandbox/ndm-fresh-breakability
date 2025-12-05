export enum InventoryPayloadType {
    DATA_INSERT = 'DATA_INSERT',
    DISCOVERY_COMPLETED = 'DISCOVERY_COMPLETED'
} 

export enum FileType {
    FILE = "FILE",
    DIRECTORY = "DIRECTORY",
    SYMBOLIC_LINK = "SYMBOLIC_LINK",
    SOCKET = "SOCKET",
    FIFO = "FIFO",
    CHARACTER_DEVICE = "CHARACTER_DEVICE",
    BLOCK_DEVICE = "BLOCK_DEVICE",
    JUNCTION = "JUNCTION",
    SHORTCUT = "SHORTCUT",
    VOLUME_MOUNT_POINT = "VOLUME_MOUNT_POINT",
    UNKNOWN = "UNKNOWN"
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
    extension: string;
    fileType: FileType;
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