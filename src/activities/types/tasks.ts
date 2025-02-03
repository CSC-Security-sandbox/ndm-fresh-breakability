import { JobContext } from "@netapp-cloud-datamigrate/jobs-lib";
import { RedisClientType } from "redis";

export interface TaskPayload {
  id: string;
  jobRunId: string;
  taskType: string;
  status: string;
  workerId: string;
  sPath: string;
  tPath: string;
  excludeFilePatterns: string;
  commands: ScanCommands[];
}

export interface ScanCommands {
  fPath: string;
  ops: {
    0: {
      [x: string]: string;
      cmd: string;
    };
  };
  commandId?: string;
  status?: string;
}

export interface DiscoveryPayload {
  data?: TaskPayload;
}

export interface WorkerMessage {
  data: TaskResponse;
  type: MessageType;
  inventory?: any[];
  unscanned?: any[];
  operations: any;
}
export enum MessageType {
  ScanResult = 'SCAN_RESULT',
  PullTask = 'PUL_TASK',
  ScanCompleted = 'SCAN_COMPLETED',
  UnScannedData = 'UNSCANNED_DATA',
  ProcessInventory = 'PROCESS_INVENTORY',
  CompleteOperation = 'COMPLETE_OPERATION',
}
export interface TaskResponse {
  id: string;
  jobRunId: string;
  taskType: string;
  status: string;
  workerId: string;
  sPath: string;
  tPath: string;
  commands: ScanCommandsResponse[];
}
export interface ScanCommandsResponse {
  fPath: string;
  ops: {
    0: {
      cmd: string;
      status: string;
      data: any;
    };
  };
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
    jobContext:JobContext;
    client:RedisClientType;
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
}
export enum FileType {
    FILE = "FILE",
    DIRECTORY = "DIRECTORY",
    SYMBOLIC_LINK = "SYMBOLIC_LINK",
    SOCKET = "SOCKET",
    FIFO = "FIFO",
    CHARACTER_DEVICE = "CHARACTER_DEVICE",
    BLOCK_DEVICE = "BLOCK_DEVICE",
    UNKNOWN = "UNKNOWN"
}
