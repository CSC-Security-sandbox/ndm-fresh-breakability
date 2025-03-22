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
}

export interface Destination {
  pathId: string;
  serverId: string;
  pathName: string;
  workers: string[];
}

export interface Settings {
  preserveAccessTime: boolean;
}

export interface ServerCredential {
  id: string;
  host: string;
  userName: string;
  password: string;
  protocol: string;
  protocolVersion: string;
  serverType: string;
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

export interface PreCheckDestinationStatus {
  destinationPathId: string;
  status: PreCheckStatus;
  errors?: PreCheckErrorCodes[];  
  commonWorkers: string[];
}

export interface WorkerTaskPaths {
  pathId: string;
  serverId: string;
  pathName: string;
  isSource: boolean;
}
export interface WorkerTaskPayload {
  settings: Settings;
  serverCredentials: ServerCredential[];
  serverPaths: WorkerTaskPaths[]
}
