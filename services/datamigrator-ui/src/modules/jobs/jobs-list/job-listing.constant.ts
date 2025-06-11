import {
  BlueXpTableRowType,
  ColumnFilterType,
  JOB_CONFIG_STATUS_ENUM,
  JobRowType,
} from "@/types/app.type";
import DateCellRenderer from "@components/custom-cell-renderer/DateCellRenderer";
import ServerPathRenderer from "@components/custom-cell-renderer/ServerPathRenderer";
import StatusCellRenderer from "@components/custom-cell-renderer/StatusCellRenderer";

import {
  formatLength,
  getJobStatusFormat,
  getJobType,
} from "@/utils/common.utils";
import { Span } from "@netapp/bxp-design-system-react";
import React from "react";

export const JOB_LIST_COLUMN_DEFS = [
  {
    header: "Job Id",
    accessor: "jobConfigId",
    id: "jobConfigId",
    width: 100,
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
    }: BlueXpTableRowType<JobRowType, JobRowType["sourceServer"]>) =>
      React.createElement(ServerPathRenderer, {
        server: value.serverName,
        path: value.path,
      }),
  },
  {
    header: "Source Name",
    accessor: "sourceServer.serverName",
    id: "sourceServerName",
    width: 180,
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
    }: BlueXpTableRowType<JobRowType, JobRowType["destinationServer"]>) =>
      React.createElement(ServerPathRenderer, {
        server: value.serverName,
        path: value.path,
      }),
  },
  {
    header: "Destination",
    accessor: "destinationServer.serverName",
    id: "destinationServerName",
    width: 180,
  },
  {
    header: "Destination Path",
    accessor: "destinationServer.path",
    id: "destinationPath",
    width: 180,
  },
  {
    header: "Protocol",
    accessor: "sourceServer.protocol",
    id: "protocol",
    width: 150,
  },
  {
    header: "Next Schedule",
    accessor: "nextScheduleDate",
    id: "nextSchedule",
    width: 170,
    Renderer: ({
      value,
    }: BlueXpTableRowType<JobRowType, JobRowType["nextScheduleDate"]>) =>
      React.createElement(DateCellRenderer, {
        value,
      }),
  },
  {
    header: "Runs",
    accessor: "totalRuns",
    id: "jobRuns",
    width: 100,
    Renderer: ({
      value,
    }: BlueXpTableRowType<JobRowType, JobRowType["totalRuns"]>) =>
      formatLength(value),
  },
  {
    header: "Type",
    accessor: "jobType",
    id: "type",
    width: 125,
    Renderer: ({
      value,
    }: BlueXpTableRowType<JobRowType, JobRowType["jobType"]>) =>
      getJobType(value),
  },
  {
    header: "Status",
    accessor: "jobStatus",
    id: "status",
    width: 125,
    Renderer: ({
      value,
    }: BlueXpTableRowType<JobRowType, JobRowType["jobStatus"]>) =>
      React.createElement(StatusCellRenderer, {
        status: getJobStatusFormat(value),
        active: value === JOB_CONFIG_STATUS_ENUM["ACTIVE"],
      }),
  },
  {
    header: "Errors",
    accessor: "errors",
    id: "errors",
    width: 100,
    Renderer: ({
      value,
    }: BlueXpTableRowType<JobRowType, JobRowType["errors"]>) =>
      value > 0
        ? React.createElement(Span, { color: "error" }, value)
        : React.createElement(Span, null, "-"),
  },
  {
    header: "Created On",
    accessor: "createdAt",
    id: "createdAt",
    width: 150,
    Renderer: ({
      value,
    }: BlueXpTableRowType<JobRowType, JobRowType["createdAt"]>) =>
      React.createElement(DateCellRenderer, { value }),
  },
  {
    header: "Updated On",
    accessor: "updatedAt",
    id: "updatedAt",
    width: 150,
    Renderer: ({
      value,
    }: BlueXpTableRowType<JobRowType, JobRowType["updatedAt"]>) =>
      React.createElement(DateCellRenderer, { value }),
  },
];

export type preSelectedFilterType = {
  sourceServerName?: string;
  jobType?: string;
};

export const defaultColumnState = {
  jobConfigId: { isHidden: true },
  sourceServerName: { isHidden: true },
  sourcePath: { isHidden: true },
  destinationServerName: { isHidden: true },
  destinationPath: { isHidden: true },
  createdAt: { isHidden: true },
  updatedAt: { isHidden: true },
};

export const COLUMNS_TO_FILTER_DEFS: ColumnFilterType[] = [
  { accessor: "sourceServerName", label: "Source" },
  { accessor: "destinationServerName", label: "Destination" },
  { accessor: "sourceServerProtocol", label: "Protocol" },
  { accessor: "jobType", label: "Type", formatter: getJobType },
  { accessor: "jobStatus", label: "Status", formatter: getJobStatusFormat },
];
