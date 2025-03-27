import DateCellRenderer from "@components/custom-cell-renderer/DateCellRenderer";
import ErrorNumberCellRenderer from "@components/custom-cell-renderer/ErrorNumberCellRenderer";
import JobRunStatusCellRenderer from "@components/custom-cell-renderer/JobRunStatusCellRenderer";
import ServerPathRenderer from "@components/custom-cell-renderer/ServerPathRenderer";
import {
  BlueXpTableRowType,
  ColumnFilterType,
  JOBS_TYPE,
  JobRunApiType,
} from "@/types/app.type";
import { getJobType, toTitleCase } from "@/utils/common.utils";
import React from "react";
import TooltipCopyCellRenderer from "@components/custom-cell-renderer/TooltipCopyCellRenderer";

const JOB_RUN_LIST_COLUMN_DEFS = [
  {
    header: "Job Run ID",
    accessor: "jobRunId",
    width: 100,
    Renderer: ({
      value,
    }: BlueXpTableRowType<JobRunApiType, JobRunApiType["jobRunId"]>) => TooltipCopyCellRenderer(value),
  },
  {
    header: "Job Type",
    accessor: "jobType",
    id: "type",
    width: 100,
    Renderer: ({
      value,
    }: BlueXpTableRowType<JobRunApiType, JobRunApiType["jobType"]>) =>
      getJobType(value),
  },
  {
    header: "Start Time",
    accessor: "startTime",
    id: "startTime",
    width: 100,
    Renderer: ({
      value,
    }: BlueXpTableRowType<JobRunApiType, JobRunApiType["startTime"]>) =>
      React.createElement(DateCellRenderer, { value }),
  },
  {
    header: "End Time",
    accessor: "endTime",
    id: "endTime",
    width: 100,
    Renderer: ({
      value,
    }: BlueXpTableRowType<JobRunApiType, JobRunApiType["endTime"]>) =>
      React.createElement(DateCellRenderer, { value }),
  },
  {
    header: "Source",
    accessor: "sourceServer",
    id: "source",
    width: 180,
    sort: {
      enabled: false,
    },
    Renderer: ({
      value,
    }: BlueXpTableRowType<JobRunApiType, JobRunApiType["sourceServer"]>) =>
      React.createElement(ServerPathRenderer, {
        server: value?.serverName,
        path: value?.path,
      }),
  },
  {
    header: "Source Name",
    accessor: "sourceServer.serverName",
    id: "sourceServerName",
    width: 100,
  },
  {
    header: "Source Path",
    accessor: "sourceServer.path",
    id: "sourcePath",
    width: 180,
  },
  {
    header: "Destination",
    accessor: "destinationServer",
    id: "destination",
    width: 180,
    sort: {
      enabled: false,
    },
    Renderer: ({
      value,
    }: BlueXpTableRowType<JobRunApiType, JobRunApiType["destinationServer"]>) =>
      React.createElement(ServerPathRenderer, {
        server: value?.serverName,
        path: value?.path,
      }),
  },
  {
    header: "Destination",
    accessor: "destinationServer.serverName",
    id: "destinationServerName",
    width: 100,
  },
  {
    header: "Destination Path",
    accessor: "destinationServer.path",
    id: "destinationPath",
    width: 180,
  },
  {
    header: "Files",
    accessor: "scannedFilesCount",
    id: "files",
    width: 80,
  },
  {
    header: "Directories",
    accessor: "scannedDirectoriesCount",
    id: "directories",
    width: 80,
  },
  {
    header: "Size",
    accessor: "totalScannedSize",
    id: "size",
    Renderer: ({ row }: BlueXpTableRowType<JobRunApiType, JobRunApiType>) => row.jobType === JOBS_TYPE.DISCOVERY ? row.totalScannedSize : row.totalMigratedSize,
    width: 80,
  },
  {
    header: "Protocol",
    accessor: "sourceServer.protocol",
    id: "protocol",
    width: 100,
  },
  {
    header: "Status",
    accessor: "status",
    id: "status",
    width: 100,
    Renderer: ({
      value,
    }: BlueXpTableRowType<JobRunApiType, JobRunApiType["status"]>) =>
      React.createElement(JobRunStatusCellRenderer, {
        status: value,
      }),
  },
  {
    header: "Errors",
    accessor: "errors",
    id: "errors",
    width: 80,
    Renderer: ({
      value,
    }: BlueXpTableRowType<JobRunApiType, JobRunApiType["errors"]>) =>
      React.createElement(ErrorNumberCellRenderer, {
        value: value.length,
      }),
  },
];

export const defaultColumnState = {
  jobConfigId: { isHidden: true },
  sourceServerName: { isHidden: true },
  sourcePath: { isHidden: true },
  destinationServerName: { isHidden: true },
  destinationPath: { isHidden: true },
  protocol: { isHidden: true },
  directories: { isHidden: true },
};

export const COLUMNS_TO_FILTER_DEFS: ColumnFilterType[] = [
  { accessor: "sourceServerName", label: "Source" },
  { accessor: "destinationServerName", label: "Destination" },
  { accessor: "sourceServerProtocol", label: "Protocol" },
  { accessor: "jobType", label: "Type", formatter: getJobType },
  { accessor: "status", label: "Status", formatter: toTitleCase },
];

export { JOB_RUN_LIST_COLUMN_DEFS };
