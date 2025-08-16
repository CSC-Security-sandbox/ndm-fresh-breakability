import {
  AllFileServerWithVolumesApiType,
  BlueXpFormType,
  BlueXpTableStateType,
  ConfigListTypeApiType,
  VolumeType,
  WorkerApiType,
} from "@/types/app.type";
import { FormikProps } from "formik";
import { ReactNode } from "react";
import { Dayjs } from "dayjs";
import {
  INCREMENTAL_SYNC_SCHEDULE_SET_ENUM,
  INCREMENTAL_SYNC_SCHEDULE_SET_WEEKLY_ENUM,
  MIGRATE_OPTION_ENUM,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.constant";
import { INCREMENTAL_SYNC_SCHEDULE_ENUM } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/IncrementalSyncSchedule/incremental-sync-schedule.constants";

export interface OptionType {
  label: string;
  value: string;
}

export interface BulkMigrateContextProviderPropsType
  extends BulkMigrateContextType {
  children: ReactNode;
}

export interface MappingStepFormikFormType {
  selectedMountPathsId: string[];
  migrationDetailsTableConfigurationValue: MigrationDetailsTableConfigurationType[];
  scheduleTime: string;
  scheduledDateTime: Dayjs;
}

export interface MigrationDetailsTableConfigurationType {
  id: number;
  sourceFileServerDetails: ConfigListTypeApiType;
  sourcePath: {
    volume: VolumeType;
    sourcePathName: string;
    sourcePathId: string;
  };
  protocol: string;
  destinationFileServerDetails: {
    destinationFileServerName: string;
    destinationFileServerId: string;
  };
  destinationPathDetails: {
    destinationPathName: string;
    destinationPathId: string;
  };
  discoveryJobCount: string;
  migrationJobCount: string;
  cutoverJobCount: string;
}

export interface DestinationPathsOptionsType {
  protocol: string;
  pathId: string;
  pathName: string;
  isDisabled?: boolean;
  isValid?: boolean;
  reachableCount?: number;
}

export interface ProtocolFormType {
  protocol: OptionType;
}

export interface FormFileUploadType {
  fileName: string;
  contents: any;
  fileSize: number;
}

export interface OptionsFormType {
  preserve_a_time: boolean;
  exclude_file_patterns: string;
  upload_sid_mapping: FormFileUploadType;
  upload_uid_mapping: FormFileUploadType;
  migrate_file_option: MIGRATE_OPTION_ENUM;
  incremental_sync_schedule: INCREMENTAL_SYNC_SCHEDULE_ENUM;

  // Skip File Options
  skipFileNum: number;
  skipFileOption: OptionType;

  // Migrate Options
  migrate_file_option_exclude: Dayjs;

  // Incremental Schedule Options - Schedule
  incremental_sync_schedule_set: INCREMENTAL_SYNC_SCHEDULE_SET_ENUM;

  // Incremental Schedule Options - Schedule - Daily
  incremental_sync_schedule_daily: Dayjs; // hh:mm aa

  // Incremental Schedule Options - Schedule - Weekly
  incremental_sync_schedule_weekly: INCREMENTAL_SYNC_SCHEDULE_SET_WEEKLY_ENUM;
  incremental_sync_schedule_weekly_day: OptionType;
  incremental_sync_schedule_weekly_day_week: OptionType;
  incremental_sync_schedule_weekly_weekday: OptionType;
  incremental_sync_schedule_weekly_weekday_week: OptionType;

  // Incremental Schedule Options - Cron Expression
  incremental_sync_schedule_cron_expression: string;

  // Incremental Schedule Options - Cron Expression - Error
  incremental_sync_schedule_cron_expression_error: string;
}

// THIS IS TYPE WHICH IS SHARED IN CONTEXT ACROSS ALL THE STEPS OF BULK MIGRATION.
export interface BulkMigrateContextType {
  migrationDetailsTableConfiguration: MigrationDetailsTableConfigurationType[];
  setMigrationDetailsTableConfiguration: (
    arg: MigrationDetailsTableConfigurationType[]
  ) => void;
  sourceFileServerDetails: ConfigListTypeApiType;
  allFileServers: AllFileServerWithVolumesApiType[];
  allExportPaths: VolumeType[];
  allWorkersList: WorkerApiType[];
  mappingStepForm: FormikProps<MappingStepFormikFormType>;
  fileServerWithPathsMap: Map<string, DestinationPathsOptionsType[]>;
  selectedMountPathsId: string[];
  setSelectedMountPathsId: (arg: string[]) => void;
  optionForm: BlueXpFormType<OptionsFormType>;
  protocolForm: BlueXpFormType<ProtocolFormType>;
  handleSubmit: (arg: any) => void;
  selectedReviewIds: string[];
  setSelectedReviewIds: (ids: string[]) => void;
  isPrecheckLoading: boolean;
  isPrecheckSuccessful: boolean;
  reviewIdsValidated: string[];
  isFormSubmitting: boolean;
  preCheckStatus: PreCheckStatusType;
  mappingStepTableState: BlueXpTableStateType<any>;
  setFileName: (arg: string) => void;
  fileName: string;
  listOfNotReachableExportPaths: string[];
  sourceDisabledPaths: string[];
  refetch: () => void;
  isFetching: boolean;
}

export interface ErrorsValidateMappingStepFormType {
  selectedMountPathsId?: string;
  scheduledDateTime?: string;
  migrationDetailsTableConfigurationValue?: Array<{
    destinationFileServerDetails?: {
      destinationFileServerName?: string;
      destinationFileServerId?: string;
    };
    destinationPathDetails?: {
      destinationPathName?: string;
      destinationPathId?: string;
    };
  }>;
}

export interface PreCheckStatusType {
  success: string[];
  failed: string[];
  errors: {
    sourcePathId: string;
    errors: string[];
  }[];
  warnings?: {
    sourcePathId: string;
    destinationPathId: string;
    warnings: string[];
  }[];
  migrationConflicts?: {
    status: string;
    jobId: string;
    jobRunIds: string[];
    sourcePathId: string;
    targetPathId: string;
    sourceServerId: string;
    targetServerId: string;
  }[];
}

export interface createPathMappingApiPayload {
  sourcePathId: string;
  destinationPathId: string[];
}

export interface UploadMappingTableDetailsType {
  toggleRowSelection: (arg: any) => void;
}

export interface bulkMigrateCreateApiType {
  firstRunAt: string | Dayjs;
  futureRunSchedule: string;
  migrateConfigs: createPathMappingApiPayload[];
  options: {
    excludeOlderThan?: Dayjs;
    excludeFilePatterns: string;
    preserveAccessTime: boolean;
    skipFile: string;
  };
  sidMapping?: any;
  gidMapping?: any;
}
