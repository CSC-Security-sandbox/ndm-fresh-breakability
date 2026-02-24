import React from "react";
import { generateOptionsWithRange } from "@/utils/common.utils";
import CutoverJobsCountRenderer from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/Mapping/components/CellRenderer/CutoverJobsCountRenderer";
import DestinationFileServer from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/Mapping/components/CellRenderer/DestinationFileServer";
import DestinationPath from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/Mapping/components/CellRenderer/DestinationPath";
import DiscoveryJobsCountRenderer from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/Mapping/components/CellRenderer/DiscoveryJobsCountRenderer";
import MigrationJobsCountRenderer from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/Mapping/components/CellRenderer/MigrationJobsCountRenderer";
import DeleteMappingCellRenderer from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/Mapping/components/CellRenderer/DeleteMappingCellRenderer";
import SourcePathCellRenderer from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/Mapping/components/CellRenderer/SourcePathCellRenderer";
import TruncatedPathCell from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/Mapping/components/CellRenderer/TruncatedPathCell";
import * as Yup from "yup";
import ValidationCellRenderer from "@components/custom-cell-renderer/ValidationCellRenderer";
import Mapping from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/Mapping/Mapping";
import Options from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/Options/Options";
import Review from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/Review/Review";
import { INCREMENTAL_SYNC_SCHEDULE_ENUM } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/IncrementalSyncSchedule/incremental-sync-schedule.constants";
import { isValidCron } from "cron-validator";

export const STEPS_MAP_BULK_MIGRATION = {
  mapping: Mapping,
  options: Options,
  review: Review,
};

export const STEPS_PATHS_BULK_MIGRATION = {
  default: [
    { label: "Mapping", key: "mapping" },
    { label: "Options", key: "options" },
    { label: "Review", key: "review" },
  ],
};

export const SKIP_FILE_OPTIONS = [
  { label: "Mins", value: "M" },
  { label: "Hrs", value: "H" },
  { label: "Days", value: "D" },
];

export enum INCREMENTAL_SYNC_SCHEDULE_SET_ENUM {
  HOURLY = "hourly",
  DAILY = "daily",
  WEEKLY = "weekly",
}

export enum INCREMENTAL_SYNC_SCHEDULE_SET_WEEKLY_ENUM {
  DAY = "day",
  WEEKDAY = "weekday",
}

export enum MIGRATE_OPTION_ENUM {
  ALL = "all",
  EXCLUDE = "excludeFilesOlderThan",
}

export const WEEKDAY_OPTIONS = [
  { label: "Sunday", value: 0 },
  { label: "Monday", value: 1 },
  { label: "Tuesday", value: 2 },
  { label: "Wednesday", value: 3 },
  { label: "Thursday", value: 4 },
  { label: "Friday", value: 5 },
  { label: "Saturday", value: 6 },
];

export const DOW_OPTIONS = generateOptionsWithRange(7); // day of the week
export const WEEK_OPTIONS = generateOptionsWithRange(52);

const ReviewPathCellRenderer = (getValue: (row: any) => string) => (props: any) =>
  React.createElement(TruncatedPathCell, {
    value: getValue(props.row) || "-",
  });

export const REVIEW_LIST_COLUMN_DEFS: any[] = [
  {
    id: 1,
    header: "Source Path",
    accessor: "source.path",
    Renderer: ReviewPathCellRenderer((row) => row?.source?.path ?? ""),
  },
  {
    id: 2,
    header: "Source Directory",
    accessor: "sourceDirectoryPath",
    Renderer: ReviewPathCellRenderer((row) => row?.sourceDirectoryPath ?? ""),
  },
  {
    id: 3,
    header: "Destination File Server",
    accessor: "destination.server",
    Renderer: ReviewPathCellRenderer((row) => row?.destination?.server ?? ""),
  },
  {
    id: 4,
    header: "Destination Path",
    accessor: "destination.path",
    Renderer: ReviewPathCellRenderer((row) => row?.destination?.path ?? ""),
  },
  {
    id: 5,
    header: "Destination Directory",
    accessor: "destinationDirectoryPath",
    Renderer: ReviewPathCellRenderer((row) => row?.destinationDirectoryPath ?? ""),
  },
  {
    header: "Precheck Status",
    accessor: "",
    id: 6,
    Renderer: ({ row: value }: any) => {
      return React.createElement(ValidationCellRenderer, {
        isValidated: value.isValidated,
        isLoading: value.isPrecheckLoading,
        status: value?.status?.success?.includes(value.source.sourcePathId),
      });
    },
  },
];

// TODO: Fix this
export const OPTIONS_FORM = Yup.object().shape({
  exclude_file_patterns: Yup.string().notRequired(),
  migrate_file_option: Yup.string()
    .oneOf(Object.values(MIGRATE_OPTION_ENUM), "Invalid selection.")
    .required("Migrate File Option is required."),
  incremental_sync_schedule: Yup.string()
    .oneOf(Object.values(INCREMENTAL_SYNC_SCHEDULE_ENUM), "Invalid selection.")
    .required("Incremental Sync Schedule Option is required."),
  incremental_sync_schedule_set: Yup.string().oneOf(
    Object.values(INCREMENTAL_SYNC_SCHEDULE_SET_ENUM),
    "Invalid selection."
  ),
  preserve_a_time: Yup.boolean(),
  preserve_permissions: Yup.boolean(),
  sid_mapping: Yup.string().notRequired(),
  uid_mapping: Yup.string().notRequired(),
  incremental_sync_schedule_weekly: Yup.string()
    .oneOf(
      Object.values(INCREMENTAL_SYNC_SCHEDULE_SET_WEEKLY_ENUM),
      "Invalid selection."
    )
    .required("Incremental Sync Schedule Option is required."),
  incremental_sync_schedule_cron_expression: Yup.string()
    .required("This field is required")
    .test(
      "is-valid-cron",
      "Invalid cron expression",
      (value) => {
        if (!value) return false;
        return isValidCron(value);
      }
    ),
  skipFileNum: Yup.number().required(
    "This field is required and needs to be num."
  ),
  upload_sid_mapping: Yup.object().shape({
    contents: Yup.string(),
    fileName: Yup.string().matches(/^.*\.csv$/, "Only CSV file is supported."),
    fileSize: Yup.number(),
  }),
  upload_uid_mapping: Yup.object().shape({
    contents: Yup.string(),
    fileName: Yup.string().matches(/^.*\.csv$/, "Only CSV file is supported."),
    fileSize: Yup.number(),
  }),
});

const DirectoryPathCellRenderer =
  (field: "sourceDirectoryPath" | "destinationDirectoryPath") =>
  ({ row }: any) => {
    const value =
      field === "sourceDirectoryPath"
        ? row?.sourceDirectoryPath ?? row?.sourcePath?.sourcePathName ?? ""
        : row?.destinationDirectoryPath ??
          row?.destinationPathDetails?.destinationPathName ??
          "";
    return React.createElement(TruncatedPathCell, { value: value || "-" });
  };

const DestinationFileServerTextRenderer = ({ row }: any) =>
  React.createElement(TruncatedPathCell, {
    value: row?.destinationFileServerDetails?.destinationFileServerName || "-",
  });
const DestinationPathTextRenderer = ({ row }: any) =>
  React.createElement(TruncatedPathCell, {
    value: row?.destinationPathDetails?.destinationPathName || "-",
  });

// Column defs for Mapping step table (Source and Destination Path Selectors) - text only, no checkboxes or dropdowns
export const BULK_MIGRATION_MAPPING_TABLE_COL_DEFS: any[] = [
  {
    id: 1,
    header: "Source Path",
    accessor: "sourcePath.sourcePathName",
    Renderer: SourcePathCellRenderer,
    sort: { enabled: false },
  },
  {
    id: 2,
    header: "Source Directory",
    accessor: "sourceDirectoryPath",
    Renderer: DirectoryPathCellRenderer("sourceDirectoryPath"),
    sort: { enabled: false },
  },
  {
    id: 3,
    header: "Destination File Server",
    accessor: "destinationFileServerDetails.destinationFileServerName",
    Renderer: DestinationFileServerTextRenderer,
    sort: { enabled: false },
  },
  {
    id: 4,
    header: "Destination Path",
    accessor: "destinationPathDetails.destinationPathName",
    Renderer: DestinationPathTextRenderer,
    sort: { enabled: false },
  },
  {
    id: 5,
    header: "Destination Directory",
    accessor: "destinationDirectoryPath",
    Renderer: DirectoryPathCellRenderer("destinationDirectoryPath"),
    sort: { enabled: false },
  },
  {
    id: 6,
    header: "Actions",
    accessor: "id",
    Renderer: DeleteMappingCellRenderer,
    sort: { enabled: false },
  },
];

export const BULK_MIGRATION_MOUNT_PATH_COL_DEFS: any[] = [
  {
    id: 1,
    header: "Source Path",
    accessor: "sourcePath.sourcePathName",
    Renderer: SourcePathCellRenderer,
  },
  {
    id: 2,
    header: "Destination",
    accessor: "destination_file_server",
    Renderer: DestinationFileServer,
    sort: {
      enabled: false,
    },
  },
  {
    id: 3,
    header: "Destination Path",
    accessor: "destination_path",
    Renderer: DestinationPath,
    sort: {
      enabled: false,
    },
  },
  {
    id: 4,
    header: "Discovery",
    accessor: "discovery",
    popoverText: "Running / Completed / Total Job Runs",
    Renderer: DiscoveryJobsCountRenderer,
    sort: {
      enabled: false,
    },
  },
  {
    id: 5,
    header: "Migration",
    popoverText: "Running / Completed / Total Job Runs",
    Renderer: MigrationJobsCountRenderer,
    sort: {
      enabled: false,
    },
    accessor: "migration",
  },
  {
    id: 6,
    header: "Cutover",
    popoverText: "Running / Completed / Total Job Runs",
    Renderer: CutoverJobsCountRenderer,
    sort: {
      enabled: false,
    },
    accessor: "cutover",
  },
];

export const PRECHECK_STATUS = {
  success: [],
  failed: [],
  errors: [],
};

export const OFFLINE_STATUS = "offline";

export const BULK_MIGRATE_STEPS_IDS = {
  mapping: 0,
  options: 1,
  review: 2,
};

export const SCHEDULE_OPTIONS = {
  START_NOW: "start_now",
  SCHEDULE_DATE: "schedule_date",
};

export const DEFAULT_MINUTES_AHEAD = {
  START_NOW: 1,
  SCHEDULE_DATE: 6,
};

export const DATE_FORMAT = "DD/MM/YYYY hh:mm:A UTC";

export const TIMESTAMP_VALIDATION = {
  SCHEDULE_FUTURE_TIMESTAMP: "Scheduled date and time must be in the future",
  SCHEDULE_LATER_TIMESTAMP:
    "Date and time is required when scheduling for later",
  SCHEDULE_FIVE_MINUTE_AHEAD_TIMESTAMP:
    "Scheduled date and time must be at least 5 minutes from now",
};
