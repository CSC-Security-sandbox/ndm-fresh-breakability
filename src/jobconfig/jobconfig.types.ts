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
  targetPathId: string[];
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
