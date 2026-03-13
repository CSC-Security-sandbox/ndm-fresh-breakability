import { JobType, Protocol } from 'src/constants/enums';

export interface UpdateJobRunMappingPayload {
  jobRunId: string;
  isActive?: boolean;
  isMounted?: true;
}

export interface Credential {
  protocol: Protocol;
  password?: string;
  pathId: string;
  directoryPath?: string;
  username: string;
  path: string;
  isValidPath: boolean;
  isDisabled: boolean;
  host: string;
  workingDirectory: string;
  protocolVersion: string;
}

export interface JobRunConfig {
  connection: {
    sourceCredential: Credential;
    targetCredential?: Credential;
  };
  jobType: JobType;
  excludeFilePatterns?: string;
  excludeOlderThan?: Date;
  preserveAccessTime: boolean;
  preservePermissions: boolean;
  shouldScanADS?: boolean;
  workers: string[];
  skipFile?: string;
  skipDelete?: boolean;
  id: string;
  jobRunId?: string; // If set, this is a retry run - skip scan and use failed items from this job run
}

export interface UnMountNotificationPayload {
  jobRunId: string;
  sPathId: string;
  tPathId?: string | undefined;
}

export enum WorkFlowFailureReason {
  SETUP_WORKER_FAILURE = 'SETUP_WORKER_FAILURE',
  WORKER_FAILURE = 'WORKER_FAILURE',
  TASK_FETCH_FAILURE = 'TASK_FETCH_FAILURE',
  SCAN_ACTIVITY_FAILURE = 'SCAN_ACTIVITY_FAILURE',
}

/** Shape of a single row returned by getErrorCounts raw query */
export interface ErrorTypeCount {
  errortype: string;
  count: number;
}

/** Shape of the workerResponse JSON column on WorkerJobRunMap entity */
export interface WorkerResponsePayload {
  code?: string;
  message?: string;
  status?: string;
  operation?: string;
  origin?: string;
  occurrence?: number;
  createdAt?: string;
  [key: string]: unknown;
}

/** Raw SQL row returned by the getJobRunList query (PostgreSQL column names are lowercase) */
export interface JobRunRawRow {
  jobrunid: string;
  jobstats: import('./dto/jobstats').JobRunStats | null;
  substatus: string | null;
  status: string;
  starttime: Date;
  endtime: Date | null;
  jobtype: string;
  jobruntype: string | null;
  isreportready: boolean;
  jobconfigid: string;
  nextschedule: string | null;
  sourceconfigname: string;
  sourcefileservername: string;
  volumepath: string;
  sourcefileserverprotocol: string;
  sourceservertype: string;
  sourcedirectorypath: string;
  targetvolumepath: string | null;
  targetconfigname: string | null;
  targetfileservername: string | null;
  targetfileserverprotocol: string | null;
  targetservertype: string | null;
  targetdirectorypath: string | null;
}

/** Single worker setup error item as returned in getFailedOperations */
export interface SetupFailedErrorItem {
  errorMessage: string;
  displayMessage: string;
  resolutionSteps: string | null;
  referenceCommands: string | null;
  errorType: 'FATAL_ERROR';
  createdAt: string;
  operationType: string;
  errorCode: string;
  origin: string;
  occurrence: number;
}
