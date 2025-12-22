import { FileInfo, JobContext, Protocol, Task, TaskStats } from "@netapp-cloud-datamigrate/jobs-lib";

export interface DiscoveryPayload {
  data?: Task;
}

export enum MessageType {
  ScanResult = 'SCAN_RESULT',
  PullTask = 'PUL_TASK',
  ScanCompleted = 'SCAN_COMPLETED',
  UnScannedData = 'UNSCANNED_DATA',
  ProcessInventory = 'PROCESS_INVENTORY',
  CompleteOperation = 'COMPLETE_OPERATION',
}

export interface ProcessFolderReadParams {
    files: string[];
    chunkPath: string;
    jobRunId: string;
    pathId: string;
    batchSize: number;
    workerId: string;
    commandId: string;
    excludePattern: string[];
    taskId;
    jobContext: JobContext,
    discoveryStats: TaskStats
}

export interface FileEntry {
    taskId: string;
    pathId: string;
    fileName: string;
    path: string;
    parentPath: string;
    jobRunId: string;
    isDirectory: boolean;
    uid: string;
    gid: string;
    fileSize: number;
    blocks: number;
    modifiedTime: string;
    birthTime: string;
    extension: string;
    permission: string;
    accessTime: string;
    fileType: string;
    depth: number;
    commandId: string;
}

export interface SetupWorkerParams {
  jobRunId: string;
  hostname: string;
  protocols:  Protocol[];
  pathId: string;
  path: string;
  userName: string;
  password: string;
  protocolType: string;
  fileServerId: string;
  volumeId: string;
  tests: any;
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
    STREAM = "STREAM",  // NTFS Alternate Data Stream
    UNKNOWN = "UNKNOWN"
}

export interface ProcessInventoryParams {
  inventory: FileEntry[];
  jobContext: JobContext;
  taskId: string;
  discoveryStats: TaskStats;
}

export interface PrecheckConfig{
  sourcePathId: string;
  destinationPathId: string[];
}

