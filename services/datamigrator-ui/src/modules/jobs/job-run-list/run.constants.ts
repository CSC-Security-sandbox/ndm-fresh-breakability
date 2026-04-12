import DateCellRenderer from "@components/custom-cell-renderer/DateCellRenderer";
import ErrorNumberCellRenderer from "@components/custom-cell-renderer/ErrorNumberCellRenderer";
import JobRunStatusCellRenderer from "@components/custom-cell-renderer/JobRunStatusCellRenderer";
import ServerPathRenderer from "@components/custom-cell-renderer/ServerPathRenderer";
import { LiveFilesCell, LiveSizeCell, LiveDirCell } from "@components/custom-cell-renderer/LiveStatCellRenderer";
import {
  BlueXpTableRowType,
  ColumnFilterType,
  JobRunApiType,
} from "@/types/app.type";
import { getJobType, getJobRunType, toTitleCase } from "@/utils/common.utils";
import React from "react";
import TooltipCopyCellRenderer from "@components/custom-cell-renderer/TooltipCopyCellRenderer";
import {
  COLUMN_WIDTH_120,
  COLUMN_WIDTH_135,
  COLUMN_WIDTH_140,
  COLUMN_WIDTH_150,
  COLUMN_WIDTH_180,
} from "@modules/jobs/job-run-list/grid.constants";

const JOB_RUN_LIST_COLUMN_DEFS = [
  {
    header: "Job Run ID",
    accessor: "jobRunId",
    width: COLUMN_WIDTH_120,
    Renderer: ({
      value,
    }: BlueXpTableRowType<JobRunApiType, JobRunApiType["jobRunId"]>) =>
      TooltipCopyCellRenderer(value),
  },
  {
    header: "Job Type",
    accessor: "jobType",
    id: "type",
    width: 110,
    Renderer: ({
      value,
    }: BlueXpTableRowType<JobRunApiType, JobRunApiType["jobType"]>) =>
      getJobType(value),
  },
  {
    header: "Start Time (UTC)",
    accessor: "startTime",
    id: "startTime",
    width: COLUMN_WIDTH_140,
    Renderer: ({
      value,
    }: BlueXpTableRowType<JobRunApiType, JobRunApiType["startTime"]>) =>
      React.createElement(DateCellRenderer, { value }),
  },
  {
    header: "End Time (UTC)",
    accessor: "endTime",
    id: "endTime",
    width: COLUMN_WIDTH_135,
    Renderer: ({
      value,
    }: BlueXpTableRowType<JobRunApiType, JobRunApiType["endTime"]>) =>
      React.createElement(DateCellRenderer, { value }),
  },
  {
    header: "Source",
    accessor: "sourceServer",
    id: "source",
    width: COLUMN_WIDTH_180,
    sort: {
      enabled: false,
    },
    Renderer: ({
      value,
      row,
    }: BlueXpTableRowType<JobRunApiType, JobRunApiType["sourceServer"]>) =>
      React.createElement(ServerPathRenderer, {
        server: value?.serverName,
        path: value?.path,
        directoryPath: value?.directoryPath,
        fileServerName: value?.fileServerName,
        serverType: value?.serverType,
        jobType: row.jobType,
      }),
  },
  {
    header: "Source Name",
    accessor: "sourceServer.serverName",
    id: "sourceServerName",
    width: COLUMN_WIDTH_150,
  },
  {
    header: "Source Path",
    accessor: "sourceServer.path",
    id: "sourcePath",
    width: COLUMN_WIDTH_180,
  },
  {
    header: "Destination",
    accessor: "destinationServer",
    id: "destination",
    width: COLUMN_WIDTH_180,
    sort: {
      enabled: false,
    },
    Renderer: ({
      value,
      row,
    }: BlueXpTableRowType<JobRunApiType, JobRunApiType["destinationServer"]>) =>
      React.createElement(ServerPathRenderer, {
        server: value?.serverName,
        path: value?.path,
        directoryPath: value?.directoryPath,
        fileServerName: value?.fileServerName,
        serverType: value?.serverType,
        jobType: row.jobType,
      }),
  },
  {
    header: "Destination",
    accessor: "destinationServer.serverName",
    id: "destinationServerName",
    width: COLUMN_WIDTH_150,
  },
  {
    header: "Destination Path",
    accessor: "destinationServer.path",
    id: "destinationPath",
    width: COLUMN_WIDTH_180,
  },
  {
    header: "Files",
    accessor: "scannedFilesCount",
    id: "files",
    width: 80,
    Renderer: ({
      row,
    }: BlueXpTableRowType<JobRunApiType, JobRunApiType>) =>
      React.createElement(LiveFilesCell, { key: row.jobRunId, row }),
  },
  {
    header: "Directories",
    accessor: "scannedDirectoriesCount",
    id: "directories",
    width: 130,
    Renderer: ({
      row,
    }: BlueXpTableRowType<JobRunApiType, JobRunApiType>) =>
      React.createElement(LiveDirCell, { key: row.jobRunId, row }),
  },
  {
    header: "Size",
    accessor: "totalScannedSize",
    id: "size",
    Renderer: ({
      row,
    }: BlueXpTableRowType<JobRunApiType, JobRunApiType>) =>
      React.createElement(LiveSizeCell, { key: row.jobRunId, row }),
    width: 80,
  },
  {
    header: "Protocol",
    accessor: "sourceServer.protocol",
    id: "protocol",
    width: COLUMN_WIDTH_120,
  },
  {
    header: "Status",
    accessor: "status",
    id: "status",
    width: COLUMN_WIDTH_120,
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
    width: 100,
    Renderer: ({
      value,
    }: BlueXpTableRowType<JobRunApiType, JobRunApiType["errors"]>) =>
      React.createElement(ErrorNumberCellRenderer, {
        value: value,
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
  { accessor: "jobRunType", label: "Type", formatter: getJobRunType },
  { accessor: "status", label: "Status", formatter: toTitleCase },
];

export { JOB_RUN_LIST_COLUMN_DEFS };
