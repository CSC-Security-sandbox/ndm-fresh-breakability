import { ExportPathSource } from "src/activities/list-path/list-path.type";

export interface PreCheckWorkflowRequest {
  traceId: string;
  payload: {
    preChecks: PreCheck[];
    settings: Settings;
    serverCredentials: ServerCredential[];
  };
  options: WorkflowOptions;
}

export interface PreCheck {
  pathId: string;
  destinations: Destination[];
  serverId: string;
  pathName: string;
  discoveredSize?: number;
}

export interface Destination {
  pathId: string;
  serverId: string;
  pathName: string;
  workers: workerRecord[]
}

export interface Settings {
  preserveAccessTime: boolean;
  preservePermissions: boolean;
}

export interface ServerCredential {
  id: string;
  host: string;
  userName: string;
  password: string;
  protocol: string;
  protocolVersion: string;
  serverType: string;
  exportPathSource: ExportPathSource;
}

interface WorkflowOptions {
  workflowExecutionTimeout: string;
  workflowTaskTimeout: string;
  workflowRunTimeout: string;
  startDelay: string;
}



export enum PreCheckErrorCodes {
  DESTINATION_PATH_MOUNT_FAILED = "DESTINATION_PATH_MOUNT_FAILED",
  SOURCE_PATH_MOUNT_FAILED = "SOURCE_PATH_MOUNT_FAILED",
  DESTINATION_PATH_WRITE_PERMISSION_FAILED = "DESTINATION_PATH_WRITE_PERMISSION_FAILED",
  SOURCE_PATH_WRITE_PERMISSION_FAILED = "SOURCE_PATH_WRITE_PERMISSION_FAILED",
  PROTOCOL_VERSION_MISMATCH = "PROTOCOL_VERSION_MISMATCH",
  NO_COMMON_WORKERS = "NO_COMMON_WORKERS",
  DESTINATION_PATH_NOT_FOUND = "DESTINATION_PATH_NOT_FOUND",
  SOURCE_PATH_NOT_FOUND = "SOURCE_PATH_NOT_FOUND",
  INSUFFICIENT_DESTINATION_SPACE = "INSUFFICIENT_DESTINATION_SPACE",
  NO_SPACE_LEFT_ON_SOURCE_PATH = 'NO_SPACE_LEFT_ON_SOURCE_PATH',
  NO_SPACE_LEFT_ON_DESTINATION_PATH = 'NO_SPACE_LEFT_ON_DESTINATION_PATH',
  ALL_COMMON_WORKERS_UNHEALTHY = 'ALL_COMMON_WORKERS_UNHEALTHY',
  SOURCE_DATA_SIZE_CALCULATION_FAILED = 'SOURCE_DATA_SIZE_CALCULATION_FAILED',
  DESTINATION_AVAILABLE_SPACE_CALCULATION_FAILED = 'DESTINATION_AVAILABLE_SPACE_CALCULATION_FAILED',
  DESTINATION_EMPTY_PATH_CHECK_FAILED = 'DESTINATION_EMPTY_PATH_CHECK_FAILED',
  DESTINATION_PATH_UNMOUNT_FAILED = "DESTINATION_PATH_UNMOUNT_FAILED",
  SOURCE_PATH_UNMOUNT_FAILED = "SOURCE_PATH_UNMOUNT_FAILED",
}

export enum PreCheckStatus {
  SUCCESS = "success",
  FAILED = "failed",
  IN_PROGRESS = "in_progress",
}

export interface PreCheckWorkflowResponse {
  sourcePathId: string;
  status: PreCheckStatus;
  destination: PreCheckDestinationStatus[];
  errors?: PreCheckErrorCodes[];
}

export interface workerRecord {
  workerId: string; 
  ishealthy: boolean
}

export interface PreCheckDestinationStatus {
  destinationPathId: string;
  status: PreCheckStatus;
  errors?: PreCheckErrorCodes[];  
  commonWorkers:workerRecord[]
  warnings?: PreCheckErrorCodes[];
}

export interface WorkerTaskPaths {
  pathId: string;
  serverId: string;
  pathName: string;
  isSource: boolean;
  discoveredSize?: number;
}
export interface WorkerTaskPayload {
  settings: Settings;
  serverCredentials: ServerCredential[];
  serverPaths: WorkerTaskPaths[]
}
