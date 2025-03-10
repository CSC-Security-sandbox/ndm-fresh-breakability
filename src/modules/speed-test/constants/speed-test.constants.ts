import { BlueXpTableRowType } from "@/types/app.type";
import * as Yup from "yup";
import { SpeedTestJobsType } from "@modules/speed-test/types/speed-test.types";
import { createElement } from "react";
import DateCellRenderer from "@components/custom-cell-renderer/DateCellRenderer";
import SpeedTestStatusCellRenderer from "@modules/speed-test/components/speed-test-configuration/cellRenderer/SpeedTestStatusCellRenderer";
import TimeElapsedRenderer from "@components/custom-cell-renderer/TimeElapsedRenderer";
import { calculateTimeDiff } from "@/utils/common.utils";
import SpeedTestFileServerNameCellRenderer from "@modules/speed-test/components/speed-test-configuration/cellRenderer/SpeedTestFileServerNameCellRenderer";
import SpeedTestProtocolNameCellRenderer from "@modules/speed-test/components/speed-test-configuration/cellRenderer/SpeedTestProtocolNameCellRenderer";
import WorkersNameCellRenderer from "@modules/speed-test/components/speed-test-configuration/cellRenderer/WorkersNameCellRenderer";
import TestsCellRenderer from "@modules/speed-test/components/speed-test-configuration/cellRenderer/TestsCellRenderer";
import SpeedTestWorkerNameCellRenderer from "@modules/speed-test/components/speed-test-details/cellRenderer/SpeedTestWorkerNameCellRenderer";
import { SpeedTestDetailsType } from "@modules/speed-test/types/speed-test-details.types";
import OverallAverageSpeedCellRenderer from "@modules/speed-test/components/speed-test-details/cellRenderer/OverallAverageSpeedCellRenderer";
import AverageSpeedCellRenderer from "@modules/speed-test/components/speed-test-details/cellRenderer/AverageSpeedCellRenderer";
import SpeedTestChevronCellRenderer from "@modules/speed-test/components/speed-test-details/cellRenderer/SpeedTestChevronCellRenderer";

export const SPEED_TEST_COLUMN_DEF = [
  {
    header: "Job Run Id",
    accessor: "jobRunId",
    id: 1,
  },
  {
    header: "Start Time",
    accessor: "startTime",
    id: 2,
    Renderer: ({
      row,
    }: BlueXpTableRowType<SpeedTestJobsType, SpeedTestJobsType>) =>
      createElement(DateCellRenderer, {
        value: row.startTime,
      }),
  },
  {
    header: "End Time",
    accessor: "endTime",
    id: 3,
    Renderer: ({
      row,
    }: BlueXpTableRowType<SpeedTestJobsType, SpeedTestJobsType>) =>
      createElement(DateCellRenderer, {
        value: row.endTime,
      }),
  },
  {
    header: "No. of File Servers",
    accessor: "fileServercount",
    id: 4,
  },
  {
    header: "No. of Workers",
    accessor: "workers",
    id: 5,
  },
  {
    header: "Status",
    accessor: "status",
    Renderer: SpeedTestStatusCellRenderer,
    id: 6,
  },
  {
    header: "Time Elapsed",
    id: 7,
    Renderer: ({
      row,
    }: BlueXpTableRowType<SpeedTestJobsType, SpeedTestJobsType>) =>
      createElement(TimeElapsedRenderer, {
        value: calculateTimeDiff(row.startTime, row.endTime),
      }),
  },
];

export const SPEED_TEST_OPTIONS = [
  {
    label: "Read",
    value: "read",
  },
  {
    label: "Write",
    value: "write",
  },
  {
    label: "Network Performance",
    value: "networkPerformance",
  },
];

export const SPEED_TEST_CONFIGURATION_FORM_COLUMN_DEF = [
  {
    id: 1,
    header: "File Server",
    accessor: "fileServer",
    Renderer: SpeedTestFileServerNameCellRenderer,
  },
  {
    id: 2,
    header: "Protocol",
    accessor: "protocol",
    Renderer: SpeedTestProtocolNameCellRenderer,
  },
  {
    id: 3,
    header: "Workers",
    accessor: "workers",
    Renderer: WorkersNameCellRenderer,
  },
  {
    id: 4,
    header: "Tests",
    accessor: "tests",
    Renderer: TestsCellRenderer,
  },
];

export const CONFIGURE_SPEED_TEST_SCHEMA = Yup.object().shape({
  fileServer: Yup.object({
    label: Yup.string().required("Label is required"),
    value: Yup.string().required("Value is required"),
  }).required("File server is required"),

  protocol: Yup.array()
    .of(Yup.object().required("Protocol is required"))
    .min(1, "At least one protocol is required")
    .required("Protocol is required"),

  workers: Yup.array()
    .of(Yup.object().required("Worker count is required"))
    .min(1, "At least one worker is required")
    .required("Workers are required"),

  tests: Yup.array()
    .of(Yup.object().required("Test is required"))
    .min(1, "At least one test is required")
    .required("Tests are required"),
});

export const SPEED_TEST_GRAPH_COLUMN_DEF = [
  {
    header: "File Server",
    accessor: "fileServerName",
    id: 1,
  },
  {
    header: "Worker",
    accessor: "workers",
    id: 2,
    Renderer: SpeedTestWorkerNameCellRenderer,
  },
  {
    header: "Protocol",
    accessor: "fileServerProtocol",
    id: 3,
  },
  {
    header: "Avg Read Speed",
    accessor: "readSpeed",
    id: 4,
    Renderer: ({
      row,
    }: BlueXpTableRowType<SpeedTestDetailsType, SpeedTestDetailsType>) =>
      createElement(OverallAverageSpeedCellRenderer, {
        workers: row.workers,
        speedAction: "readSpeed",
      }),
  },
  {
    header: "Avg Write Speed",
    accessor: "writeSpeed",
    id: 5,
    Renderer: ({
      row,
    }: BlueXpTableRowType<SpeedTestDetailsType, SpeedTestDetailsType>) =>
      createElement(OverallAverageSpeedCellRenderer, {
        workers: row.workers,
        speedAction: "writeSpeed",
      }),
  },
  {
    header: "Avg RTD Network",
    accessor: "rtd",
    popoverText: "Sample",
    id: 6,
    Renderer: ({
      row,
    }: BlueXpTableRowType<SpeedTestDetailsType, SpeedTestDetailsType>) =>
      createElement(AverageSpeedCellRenderer, {
        workers: row.workers,
        type: "rtd",
      }),
  },
  {
    header: "Avg Packet Loss",
    accessor: "packetLoss",
    popoverText: "Sample",
    id: 7,
    Renderer: ({
      row,
      rowState,
    }: BlueXpTableRowType<SpeedTestDetailsType, SpeedTestDetailsType>) =>
      createElement(SpeedTestChevronCellRenderer, {
        row,
        rowState,
        type: "packetLoss",
      }),
  },
];

export const SPEED_TEST_TABLE_OPTIONS = [
  { label: "Read Speed", value: "readSpeed" },
  { label: "Write Speed", value: "writeSpeed" },
];

export enum SPEED_TEST_ENUM {
  "jobRunId" = "Job Run ID",
  "startTime" = "Start Time",
  "endTime" = "End Time",
  "noOfFileServers" = "No. of File Server",
  "status" = "Status",
  "timeElapsed" = "Time Elapsed",
  "totalWorkers" = "No. of Workers",
}

export enum SPEED_TEST_DETAILS_STATUS {
  "COMPLETED" = "bg-chart-5",
  "RUNNING" = "bg-icon-primary",
}

export const SPEED_TEST_ERROR = "New speed test creation error";

export const SPEED_TEST_SUCCESS =
  "New speed test has been created successfully";

export const SPEED_TEST_TOOLTIP =
  "Please note that the specified path is currently unavailable, and the file server is inactive.";
