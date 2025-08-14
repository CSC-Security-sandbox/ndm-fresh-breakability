/* eslint-disable */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * API Response - <api_name>ApiType e.g. userStatusApiType
 * Variable - <variable>Type e.g. userIdType
 * Component Props - <component_name>PropsType e.g. UserDetailsPropsType
 * Form - <form_name>FormType e.g. CreateProjectFormType
 */

import { ReactNode } from "react";
import { WorkingDirectoryDetailsType } from "@modules/storage-servers/file-server/fileServer.interface";

export type GraphLoaderType = {
  label: string;
  isLoading: boolean;
  children: React.ReactNode;
};

export type DataItemType = {
  value: number | string;
  category: string;
  sub_category: string;
};

export type ProcessedData = {
  data: number[];
  categories: string[];
};

export type FileInfo = {
  fileName: string;
  fileSize: number;
};

export interface WorkerApiType {
  _id: string;
  projectId: string;
  clientId: string;
  status: string;
  workerName: string;
  workerId: string;
  ipAddress: string;
  createdOn: string;
  updatedAt: string;
}

interface JobRunDetail {
  id: string;
  status: string;
}

interface JobConfig {
  id: string;
  jobType: string;
  jobRunDetails: JobRunDetail[];
}

export interface VolumeType {
  id: string;
  volumePath: string;
  jobConfig: JobConfig[];
  protocol: string;
  isValid?: boolean;
}

interface DataType {
  _id: string;
  requestType: string;
  status: string;
  requestId: string;
  workerId: string;
  createdOn: string;
  updatedAt: string;
  operation: "VALIDATE_NFS_CONNECTION" | "VALIDATE_SMB_CONNECTION";
  response: any;
}

export interface MountPointsListApiType {
  data: DataType[];
  total: number;
}

interface CompletedConnection {
  traceId: string;
  status: WorkerConnectionStatus;
  protocolType: ProtocolType;
  hostname: string;
  workerId: string;
  paths: string[];
  protocolVersions: string[];
  message: string;
}

export interface ValidateConnectionApiType {
  status: ValidateConnectionStatus;
  id: string;
  pending: any[];
  completed: CompletedConnection[];
}

interface ProjectType {
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string | null;
  id: string;
  projectName: string;
  startDate: string;
}

export type ReportDataPayloadType = {
  jobRunId: string;
  reportType: string;
};

// ============================CONFIG LISTING PAGE============================

interface ProjectType {
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string | null;
  id: string;
  projectName: string;
  startDate: string;
}

export interface WorkerApiType {
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string | null;
  workerId: string;
  projectId: string;
  clientId: string;
  workerName: string;
  ipAddress: string;
  status: string;
  protocol?: string;
}

export interface FileServerApiType {
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string | null;
  id: string;
  host: string;
  userName: string;
  password: string;
  protocol: string;
  serverType: string;
  isRefreshed: boolean;
  configId: string | null;
  protocolVersion: string;
  workers: WorkerApiType[];
  volumes: VolumeType[]; // Adjust this type if you have specific volume data structure
  exportPathSource?: string;
}

export type ConfigListTypeApiType = {
  scannedDate: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string | null;
  id: string;
  stage: string;
  configName: string;
  configType: string;
  projectId: string;
  project: ProjectType;
  fileServers: FileServerApiType[];
  workingDirectory: WorkingDirectoryDetailsType;
  status: FILE_SERVER_STATUS_ENUM;
  isRefreshAvailable?: boolean;
  isUploadInProgress?: boolean;
};

export type FileServerDetailsType = ConfigListTypeApiType;

export interface BlueXpFormType<T> {
  resetForm: (state: any, resetSubmissionAttempted?: boolean) => void;
  handleFormSubmit: (callback: any) => (event: any) => void;
  setSubmissionAttempted: () => void;
  handleFormChange: (_valueOrEvent: any, _Event: any) => void;
  wrappedHandleFormChange: (name: any) => (value: any, event: any) => void;
  formState: T;
  dirty: any;
  isDirty: any;
  isValid: any;
  formErrors: {};
  submissionAttempted: any;
  resetSubmissionAttempted: () => void;
}

export interface BlueXpTableRowType<T, T1> {
  id: string | number;
  row: T;
  column: {
    header: string;
    accessor: string;
    sortable: boolean;
    filter: boolean;
    id: number;
    width: number;
  };
  isMultiSelect: boolean;
  selectRow: boolean;
  rowState: {
    [key: string]: any;
  };
  value: T1;
  disabled: boolean;
}

export interface InviteUserResponseType {
  user: {
    email: string;
    user_status: string;
    id: string;
  };
  tempPassword: string;
}

export interface RolesType {
  role_name: string;
  projects: (string | null)[];
  permissions: string[];
}

export interface UserPermissionsApiType {
  roles: RolesType[];
  id: string;
}

export interface GetAllWorkersApiType {
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string | null;
  workerId: string;
  projectId: string;
  clientId: string;
  workerName: string;
  ipAddress: string;
  status: string;
}

export interface AssociatedUsersOptionsType {
  user: { label: string; value: string };
  role: { label: string; value: string };
}

export interface CreateProjectFormType {
  project_name: string;
  project_description: string;
  account_id: string;
  start_date: any;
}

export interface CreateProjectResponseType {
  data: {
    id: string;
    items: any;
    // Add other properties as needed based on the actual API response
  };
}

interface CreateProjectHOCType {
  createProjectForm: BlueXpFormType<CreateProjectFormType>;
  handleCreateProject: () => Promise<CreateProjectResponseType>;
  resetForm: Function;
  handleUpdateProject: Function;
}

export interface CreateProjectPropsType extends CreateProjectHOCType {
  closeAction: Function;
  submitAction?: Function;
  editSelectedProject: any;
}

export interface AssociatedUsersPropsType {
  associatedUsers: AssociatedUsersOptionsType[];
  associateUserForm: BlueXpFormType<AssociatedUsersOptionsType>;
  userOptions: any[];
  roleOptions: any[];
  submitUserAction: Function;
  removeUserAction: Function;
}

export enum TASK_STATUS_TYPE_ENUM {
  PENDING = "PENDING",
  RUNNING = "RUNNING",
  COMPLETED = "COMPLETED",
  ERRORED = "ERRORED",
}

export enum TASK_TYPE_TYPE_ENUM {
  SCAN = "SCAN",
  MIGRATE = "MIGRATE",
  COPY = "COPY",
}

export enum JOB_STATUS_TYPE_ENUM {
  READY = "READY",
  PENDING = TASK_STATUS_TYPE_ENUM.PENDING,
  RUNNING = TASK_STATUS_TYPE_ENUM.RUNNING,
  PAUSED = "PAUSED",
  PAUSING = "PAUSING",
  STOPPED = "STOPPED",
  COMPLETED = TASK_STATUS_TYPE_ENUM.COMPLETED,
  FAILED = "FAILED",
  ERRORED = TASK_STATUS_TYPE_ENUM.ERRORED,
  BLOCKED = "BLOCKED",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
}

export enum JOB_ACTION_STATUS_ENUM {
  PAUSE = "PAUSE",
  RESUME = "RESUME",
  STOP = "STOP",
}

export enum JOBS_TYPE {
  DISCOVERY = "DISCOVER",
  MIGRATE = "MIGRATE",
  CUT_OVER = "CUT_OVER",
}

export enum JOB_CONFIG_STATUS_ENUM {
  ACTIVE = "ACTIVE",
  INACTIVE = "IN_ACTIVE",
}

export type FileServerApiPropType = {
  serverName: string;
  path: string;
  protocol: "NFS" | "SMB";
};

type JobErrors = any[]; // API is in development, so response is not yet fixed.

export type JobRunApiType = {
  jobRunId: string;
  jobConfigId: string;
  status: JOB_STATUS_TYPE_ENUM;
  startTime: string;
  endTime: string;
  jobType: JOBS_TYPE;
  timeElapsed: number;
  scannedFilesCount: number;
  scannedDirectoriesCount: number;
  totalScannedSize: string;
  totalMigratedSize: string;
  errors: JobErrors;
  sourceServer: FileServerApiPropType;
  destinationServer: FileServerApiPropType;
  isReportReady: boolean;
};

export interface JobConfigDetailsApiType {
  id: string;
  jobType: JOBS_TYPE;
  sourceServer: FileServerApiPropType;
  destinationServer: FileServerApiPropType;
  status: JOB_CONFIG_STATUS_ENUM;
  createdAt: string;
  jobRuns: JobRunApiType[];
  errors: JobErrors;
  aggregateData: JobRunApiType;
}

export interface TasksApiType {
  id: string;
  jobRunId: string;
  taskType: TASK_TYPE_TYPE_ENUM;
  status: TASK_STATUS_TYPE_ENUM;
  createdAt: string;
  updatedAt: string;
  workerId: string;
}

export type JobStatsType = {
  fileCount: string;
  totalSize: string;
  directories: string;
};

export interface JobRunDetailsApiType {
  id: string;
  jobConfig: {
    id: string;
    jobType: JOBS_TYPE;
    sourceServer: FileServerApiPropType;
    destinationServer: FileServerApiPropType;
  };
  status: JOB_STATUS_TYPE_ENUM;
  createdAt: string;
  task: {
    completed: number;
    pending: number;
    errored: number;
    running: number;
  };
  startTime: string;
  endTime: string;
  discovery?: JobStatsType;
  migrate?: JobStatsType;
  cutOver?: JobStatsType;
  worker: number;
}

export interface JobRowType {
  jobConfigId: string;
  jobType: JOBS_TYPE;
  jobStatus: JOB_CONFIG_STATUS_ENUM;
  nextScheduleDate: string;
  sourceServer: FileServerApiPropType;
  destinationServer: FileServerApiPropType;
  errors: number;
  totalRuns: number;
  createdAt: string;
  updatedAt: string;
}

export interface FileServerOverviewApi {
  jobDetails: {
    totalDiscoverJobs: number;
    totalMigrateJobs: number;
    totalCutoverJobs: number;
  };
  storageDetails: {
    totalDiscoveredSize: string;
    totalMigratedSize: string;
    totalFileServers?: number;
    totalPendingSize: string;
  };
}

export enum USER_STATUS_ENUM {
  ACTIVE = "active",
  INACTIVE = "inactive",
}

export interface UserApiType {
  created_at: string;
  created_by?: {
    id: string;
    email: string;
    user_status: USER_STATUS_ENUM;
  };
  updated_at: string;
  updated_by?: {
    id: string;
    email: string;
    user_status: USER_STATUS_ENUM;
  };
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  user_status: USER_STATUS_ENUM;
  isAppAdmin: boolean;
}

export enum USER_ROLES_ENUM {
  APP_ADMIN = "App Admin",
  PROJECT_ADMIN = "Project Admin",
  PROJECT_VIEWER = "Project Viewer",
}
export interface UserWithRolesApiType {
  userId: string;
  email: string;
  userStatus: USER_STATUS_ENUM;
  roles: {
    roleId: string;
    roleName: USER_ROLES_ENUM;
    projectId: string | null;
  }[];
}

export interface ProjectApiType {
  created_at: string;
  created_by: {
    id: string;
    email: string;
    user_status: USER_STATUS_ENUM;
  };
  updated_at: string;
  updated_by: {
    id: string;
    email: string;
    user_status: USER_STATUS_ENUM;
  };
  id: string;
  project_name: string;
  start_date: string;
  project_description: string;
  account: {
    created_at: string;
    created_by: string;
    updated_at: string;
    updated_by: string;
    id: string;
    account_name: string;
  };
}

export enum FILE_SERVER_STATUS_ENUM {
  ACTIVE = "ACTIVE",
  DRAFT = "DRAFT",
  IN_PROGRESS = "IN_PROGRESS",
  ERRORED = "ERRORED",
}

export type TaskInfoCardPropType = {
  label: string | ReactNode;
  value: string | number | ReactNode;
  url: string;
};

export type JobRunTaskCardPropType = {
  jobRunDetails?: JobRunDetailsApiType;
};

export type JobRunHeaderPropType = JobRunTaskCardPropType;

export type JobInfoReverseCardPropType = {
  label: string;
  value: string | number | ReactNode;
  valueType?: string;
};

export type JobInfoCardPropType = {
  label: string;
  value: ReactNode | string;
};

export type JobHeaderPropType = {
  jobConfigDetails?: JobConfigDetailsApiType;
};

export type JobDescriptionProps = {
  id?: string;
  source?: FileServerApiPropType;
  destination?: FileServerApiPropType;
};

export type JobDescriptionColumnPropType = {
  name: string;
  value: string | ReactNode;
};

export interface AllFileServerWithVolumesApiType {
  id: string;
  configName: string;
  fileServers: {
    id: string;
    protocol: string;
    volumes: {
      id: string;
      volumePath: string;
      isValid?: boolean;
      isDisabled?: boolean;
      reachableCount: number;
    }[];
  }[];
}

export type GetActionMenuPropType = {
  jobRunId: JobRunApiType["jobRunId"];
  status: JobRunApiType["status"];
  handleUpdateStatus: (
    jobRunId: JobRunApiType["jobRunId"],
    status: JOB_ACTION_STATUS_ENUM
  ) => void;
  isDisabled: Boolean;
  adhocRun: () => void;
};

export type ValidationCellRendererPropType = {
  isValidated?: boolean;
  status: boolean;
  isLoading: boolean;
};
export interface GetAllCutOverPathsApiType {
  id: string; // This id index ID  will be added by blueXp Table not UUID
  sourcePath: {
    id: string;
    sourcePathName: string;
  };
  protocol: string;
  destinationFileServer: {
    id: string;
    destinationFileServerName: string;
  };
  destinationPath: {
    id: string;
    destinationPathName: string;
  };
  jobConfig: {
    id: string;
    jobType: string;
    jobRunDetails: {
      id: string;
      status: string;
    };
  }[];
}
export type NameCellRendererProps = {
  first_name: string;
  last_name: string;
  isAppAdmin: boolean;
};
export type ColumnFilterType = {
  accessor: string;
  label: string;
  formatter?: Function;
};

export type FiltersType = {
  rows: any[];
  columnsToFilter?: ColumnFilterType[];
  setFilters?: Function;
  preSelectedFilter?: any;
  gotoPage?: (page: number) => void;
};

export type LegendWrapperPropsType = {
  title: string;
  value: string | number | any;
  color: string;
  unit: string;
  valueTooltip?: string;
};

export type RemoveCellRendererPropType = {
  deleteRow: Function;
  disabled?: boolean;
};

export enum ValidateConnectionStatus {
  RUNNING = "RUNNING",
  COMPLETED = "COMPLETED",
  TERMINATED = "TERMINATED",
  TIMED_OUT = "TIMED_OUT",
  FAILED = "FAILED",
}

export enum WorkerConnectionStatus {
  SUCCESS = "success",
  ERROR = "error",
}

export enum ProtocolType {
  NFS = "NFS",
  SMB = "SMB",
}

export interface ChartInfoPropsType {
  Icon: any;
  title: string;
  children: ReactNode;
  isLoading: boolean;
  isError: boolean;
}

export interface ChartErrorPropsType {
  children: string;
  hideErrorIcon?: boolean;
}

export type TemporaryPasswordPropsType = {
  temporaryPassword: string;
  handlePasswordClose: () => void;
  isAddUser: boolean;
};

export enum REPORT_TYPES_ENUM {
  DISCOVERY = "DISCOVER",
  COC = "COC",
  JOBS_REPORT = "JOBS_REPORT",
}

export enum CUTOVER_STATUS_TYPE_ENUM {
  APPROVED = JOB_STATUS_TYPE_ENUM.APPROVED,
  REJECTED = JOB_STATUS_TYPE_ENUM.REJECTED,
}

export type CutOverConfirmModalPropType = {
  jobRunId: string;
  closeConfirmationBox: () => void;
};

export interface BlueXpTableStateType<T> {
  rows: T;
  organizedRows: any;
  columns: any;
  sortState: any;
  filterState: any;
  tableState: any;
  rowState: any;
  selectionState: any;
  columnState: any;
  toggleSort: ({ id }: { id: any }) => void;
  updateFilterState: (payload: any) => void;
  updateRowState: (id: any) => (stateOrFunc: any) => void;
  updateTextFilter: (value: any) => void;
  toggleRowSelection: (id: any) => (value: any) => void;
  selectAllRows: (value: any, resetDirty?: boolean) => void;
  resetFilters: () => void;
  pagination: {
    pageIndex: any;
    pageRows: any;
    pageCount: any;
    gotoPage: (i: any) => void;
  };
  updateColumnState: (state: any) => void;
  restoreColumnStateDefaults: () => void;
  gotoPage: (i: any) => void;
}

export interface JobErrorType {
  id: string;
  errorCode: string;
  errorMessage: string; // Original system message
  displayMessage?: string; // User-friendly mapped message
  resolutionSteps?: string; // Resolution steps from error_remedies
  referenceCommands?: string; // Diagnostic commands
  fileName: string;
  filePath: string;
  createdAt: string;
  origin: string | null;
  operationType: string | null;
  errorType: string;
  operation: string | null;
}

export interface JobRunErrorsApiType {
  data: JobErrorType[];
  total: number;
}

export interface JobRunErrorsOverviewApiType {
  errortype: JOB_RUN_ERRORS_TYPE_KEY;
  count: number;
}

export enum JOB_RUN_ERRORS_TYPE_KEY {
  FATAL_ERROR = "FATAL_ERROR",
  TRANSIENT_ERROR = "TRANSIENT_ERROR",
  RECOVERABLE_ERROR = "RECOVERABLE_ERROR",
}

export interface ToEmailType {
  label: string;
  value: string;
}

export interface SmtpDataPropsType {
  ip_address: string;
  port: number;
  user_name: string;
  password: string;
  from_email: string;
  to_email: ToEmailType[];
}

export interface smtpValuesType {
  SMTP_HOST: string;
  SMTP_PORT: string;
  SMTP_USER_NAME: string;
  SMTP_PASSWORD: string;
  SMTP_FROM_EMAIL: string;
  SMTP_TO_EMAIL: string;
}

export interface TooltipRendererProps {
  tooltipContent: string;
  children: React.ReactNode;
  show?: boolean;
}

type ErrorType = {
  count: number;
  errortype: string;
};

export interface ErrorNumberCellRendererProps {
  value: ErrorType[];
}

export type isBundleReadyApiType = {
  isBundleReady: boolean;
  isProcessing: boolean;
  error: null | string;
  filters?: {
    startDate: string;
    endDate: string;
    otherMetrics: string[];
  };
  createdAt?: string;
};

// About NDM API Response Types
export interface AboutNDMApiRespType {
  product: {
    name: string;
    version: string;
  };
  build: {
    worker_version: {
      version: string;
      time: string | null;
    };
    controlPlane_version: {
      version: string;
      time: string | null;
    };
  };
  contact: {
    email: string;
    phone: string | null;
    website: string | null;
  };
}
