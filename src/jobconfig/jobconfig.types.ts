import {
  JobConfigBulkMigrateResStatus,
  JobStatus,
  JobType,
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
    destinationPathId: string;
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

export interface ServerCredentials{
  id: string;
  host: string;
  userName: string;
  password: string;
  protocol: string;
  serverType: string;
  protocolVersion: string;
}
export interface PreChecks {
  pathId: string;
  pathName: string;
  serverId: string
  destinations: {
    pathId: string;
    pathName: string;
    serverId: string
    workers: { workerId: string; ishealthy: boolean }[]
  }[],
}
export interface PreCheckWorkflowOPayload {
  serverCredentials: ServerCredentials[];
  settings: {
    preserveAccessTime: boolean;
  },
  preChecks: PreChecks[]
}