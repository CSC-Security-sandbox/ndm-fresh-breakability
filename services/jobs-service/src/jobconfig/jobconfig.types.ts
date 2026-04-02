import {
  JobConfigBulkMigrateResStatus,
  JobStatus,
  JobType,
  Protocol,
} from "src/constants/enums";

export interface InActivateJobConfigPayload {
  jobConfigId: string;
}

export interface JobConfigBulkMigrateRes {
  id: string;
  jobType: JobType;
  status: JobConfigBulkMigrateResStatus;
  sourcePathId: string;
  targetPathId: string;
}

export interface JobConfigBulkMigrateFinalResponse {
  jobs: JobConfigBulkMigrateRes[];
  warnings?: {}[];
}

export interface JobConfigBulkCutoverRes {
  id: string;
  jobType: JobType;
  status: JobStatus;
  firstRunAt: Date;
  sourcePathId: string;
  targetPathId: string;
}
export type FlattenedCutoverConfig = {
    sourcePathId: string;
    sourceDirectoryPath?: string;
    destinationPathId: string;
    destinationDirectoryPath?: string;
};

export type SpeedTestJobRun = {
  jobRunId: string;
  jobConfigId: string;
  startTime: Date;
  endTime: Date;
  fileServerCount: number;
  workers: number;
  status: string;
}

export type SpeedTestEntry = {
  jobRunId: string;
  startTime: Date;
  endTime: Date;
  totalWorkers: number;
  fileServers: any[];
  status: string;
}

export interface JobConfigPrecheckRes {
  status: string;
  sourcePathId: string;
  details: PrecheckDestination[];
}
export interface PrecheckDestination {
  destinationPathId: string;
  status: string;
  errors?: string[];
}

export enum ExportPathSource {
  AUTO_DISCOVER = 'AUTO_DISCOVER',
  MANUAL_UPLOAD = 'MANUAL_UPLOAD',
}

export interface ServerCredentials {
  id: string;
  host: string;
  userName: string;
  password: string;
  protocol: string;
  serverType: string;
  protocolVersion: string;
  exportPathSource: ExportPathSource;
}

export interface workerWithStatus {
  workerId: string;
  ishealthy: boolean 
}
export interface PreChecks {
  pathId: string;
  discoveredSize?: number;
  pathName: string;
  sourceDirectoryPath?: string;
  serverId: string
  destinations: {
    pathId: string;
    pathName: string;
    targetDirectoryPath?: string;
    serverId: string
    workers: workerWithStatus[]
  }[],
}
export interface PreCheckWorkflowOPayload {
  serverCredentials: ServerCredentials[];
  settings: {
    preserveAccessTime: boolean;
    preservePermissions: boolean;
  },
  preChecks: PreChecks[]
}

export interface PreCheckCircularDependency {
  status: string;
  jobId: string;
  sourcePathId: string;
  targetPathId: string;
  sourceDirectoryPath?: string | null;
  targetDirectoryPath?: string | null;
  sourceServerId: string;
  targetServerId: string;
  conflictType: 'circular' | 'destination' | 'source';
  jobType: string;
}

//Parameters required to mount a remote NFS or SMB file-system share.
export interface MountRequest {
  fileServerId: string;
  hostname: string;
  exportPath: string;
  dir: string;
  protocol: Protocol;
  username?: string;
  password?: string;
  protocolVersion?: string;
}

//Metadata returned after a successful mount, used to track and manage the active mount.
export interface MountDetails {
  key: string;
  fileServerId: string;
  hostname: string;
  exportPath: string;
  dir?: string;
  protocol: Protocol;
  mountPath: string;
  mountedAt: number;
  lastAccessAt: number;
}

//Input for listing directories within an already-mounted file system.
export interface ListDirsInput {
  mountPath: string;
  path?: string;
  protocol?: Protocol;
}

//A single directory entry returned by directory listing operations
export interface DirectoryEntry {
  name: string;
}
