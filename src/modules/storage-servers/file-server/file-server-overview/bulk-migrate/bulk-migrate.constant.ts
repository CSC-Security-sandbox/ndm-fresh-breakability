import React from "react";
import { generateOptionsWithRange } from "@/utils/common.utils";
import CutoverJobsCountRenderer from "./components/steps/Mapping/components/CellRenderer/CutoverJobsCountRenderer";
import DestinationFileServer from "./components/steps/Mapping/components/CellRenderer/DestinationFileServer";
import DestinationPath from "./components/steps/Mapping/components/CellRenderer/DestinationPath";
import DiscoveryJobsCountRenderer from "./components/steps/Mapping/components/CellRenderer/DiscoveryJobsCountRenderer";
import MigrationJobsCountRenderer from "./components/steps/Mapping/components/CellRenderer/MigrationJobsCountRenderer";
import SourcePathCellRenderer from "./components/steps/Mapping/components/CellRenderer/SourcePathCellRenderer";
import * as Yup from "yup";
import ValidationCellRenderer from "@components/custom-cell-renderer/ValidationCellRenderer";
import Mapping from "./components/steps/Mapping/Mapping";
import Options from "./components/steps/Options/Options";
import Review from "./components/steps/Review/Review";

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

export enum INCREMENTAL_SYNC_SCHEDULE_ENUM {
  OFF = "Off",
  SCHEDULE = "schedule",
  CRON_EXPRESSION = "cron_expression",
}

export enum MIGRATE_OPTION_ENUM {
  ALL = "all",
  EXCLUDE = "excludeFilesOlderThan",
}

export const WEEKDAY_OPTIONS = [
  { label: "Monday", value: 1 },
  { label: "Tuesday", value: 2 },
  { label: "Wednesday", value: 3 },
  { label: "Thursday", value: 4 },
  { label: "Friday", value: 5 },
  { label: "Saturday", value: 6 },
  { label: "Sunday", value: 7 },
];

export const DOW_OPTIONS = generateOptionsWithRange(7); // day of the week
export const WEEK_OPTIONS = generateOptionsWithRange(52);

export const REVIEW_LIST_COLUMN_DEFS: any[] = [
  {
    id: 2,
    header: "Source Path",
    accessor: "source.path",
  },
  {
    header: "Destination",
    accessor: "destination.server",
    id: 3,
  },
  {
    header: "Destination Path",
    accessor: "destination.path",
    id: 4,
  },
  {
    header: "Precheck Status",
    accessor: "",
    id: 5,
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
  sid_mapping: Yup.string().notRequired(),
  uid_mapping: Yup.string().notRequired(),
  incremental_sync_schedule_weekly: Yup.string()
    .oneOf(
      Object.values(INCREMENTAL_SYNC_SCHEDULE_SET_WEEKLY_ENUM),
      "Invalid selection."
    )
    .required("Incremental Sync Schedule Option is required."),
  incremental_sync_schedule_cron_expression: Yup.string().required(
    "This field is required"
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

export const BULK_MIGRATION_MOUNT_PATH_COL_DEFS: any[] = [
  {
    id: 1,
    header: "Source Path",
    accessor: "sourcePath.sourcePathName",
    Renderer: SourcePathCellRenderer,
    width: 200,
  },
  {
    id: 2,
    header: "Destination",
    accessor: "destination_file_server",
    Renderer: DestinationFileServer,
    sort: {
      enabled: false,
    },
    width: 250,
  },
  {
    id: 3,
    header: "Destination Path",
    accessor: "destination_path",
    Renderer: DestinationPath,
    sort: {
      enabled: false,
    },
    width: 250,
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
    width: 10,
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
    width: 10,
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
    width: 10,
  },
];

export const PRECHECK_STATUS = {
  success: [],
  failed: [],
  errors: [],
};
