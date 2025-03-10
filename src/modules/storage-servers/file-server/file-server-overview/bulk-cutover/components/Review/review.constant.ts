import DateCellRenderer from "@components/custom-cell-renderer/DateCellRenderer";
import ErrorNumberCellRenderer from "@components/custom-cell-renderer/ErrorNumberCellRenderer";
import JobRunStatusCellRenderer from "@components/custom-cell-renderer/JobRunStatusCellRenderer";
import ServerPathRenderer from "@components/custom-cell-renderer/ServerPathRenderer";
import { BlueXpTableRowType, JobRunApiType } from "@/types/app.type";
import { getJobType } from "@/utils/common.utils";
import React from "react";

export const JOB_RUN_LIST_COLUMN_DEFS_REVIEW = [
  {
    header: "Job Run ID",
    accessor: "jobRunId",
    width: 100,
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
    header: "Source Path",
    accessor: "sourceServer.path",
    id: "sourcePath",
    width: 180,
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
    header: "Size",
    accessor: "totalScannedSize",
    id: "size",
    width: 80,
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
