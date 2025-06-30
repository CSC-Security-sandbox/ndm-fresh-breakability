import DateCellRenderer from "@components/custom-cell-renderer/DateCellRenderer";
import ErrorNumberCellRenderer from "@components/custom-cell-renderer/ErrorNumberCellRenderer";
import JobRunStatusCellRenderer from "@components/custom-cell-renderer/JobRunStatusCellRenderer";
import TimeElapsedRenderer from "@components/custom-cell-renderer/TimeElapsedRenderer";
import { BlueXpTableRowType, JOBS_TYPE, JobRunApiType } from "@/types/app.type";
import TooltipCopyCellRenderer from "@components/custom-cell-renderer/TooltipCopyCellRenderer";

const JOB_RUN_LIST_COLUMN_DEFS = [
  {
    header: "Job Run ID",
    accessor: "jobRunId",
    Renderer: ({
      value,
    }: BlueXpTableRowType<JobRunApiType, JobRunApiType["jobRunId"]>) =>
      TooltipCopyCellRenderer(value),
  },
  {
    header: "Start Date & Time (UTC)",
    accessor: "startTime",
    id: "startTime",
    width: 100,
    Renderer: ({
      value,
    }: BlueXpTableRowType<JobRunApiType, JobRunApiType["startTime"]>) => (
      <DateCellRenderer value={value} />
    ),
  },
  {
    header: "End Date & Time (UTC)",
    accessor: "endTime",
    id: "endTime",
    width: 100,
    Renderer: ({
      value,
    }: BlueXpTableRowType<JobRunApiType, JobRunApiType["endTime"]>) => (
      <DateCellRenderer value={value} />
    ),
  },
  {
    header: "Time Elapsed",
    accessor: "timeElapsed",
    id: "timeElapsed",
    width: 100,
    Renderer: ({
      value,
    }: BlueXpTableRowType<JobRunApiType, JobRunApiType["timeElapsed"]>) => (
      <TimeElapsedRenderer value={value} />
    ),
  },
  {
    header: "Files",
    accessor: "scannedFilesCount",
    id: "scannedFilesCount",
    width: 80,
  },
  {
    header: "Directories",
    accessor: "scannedDirectoriesCount",
    id: "scannedDirectoriesCount",
    width: 80,
  },
  {
    header: "Size",
    accessor: "totalScannedSize",
    id: "totalScannedSize",
    Renderer: ({ row }: BlueXpTableRowType<JobRunApiType, JobRunApiType>) =>
      row.jobType === JOBS_TYPE.DISCOVERY
        ? row.totalScannedSize
        : row.totalMigratedSize,
    width: 80,
  },
  {
    header: "Status",
    accessor: "status",
    id: "status",
    width: 100,
    Renderer: ({
      value,
    }: BlueXpTableRowType<JobRunApiType, JobRunApiType["status"]>) => (
      <JobRunStatusCellRenderer status={value} />
    ),
  },
  {
    header: "Errors",
    accessor: "errors",
    id: "errors",
    width: 80,
    Renderer: ({
      value,
    }: BlueXpTableRowType<JobRunApiType, JobRunApiType["errors"]>) => (
      <ErrorNumberCellRenderer value={value} />
    ),
  },
];

const DUMMY_DATA = {
  jobId: "123",
  type: "Migration",
  status: "Completed",
  source: {
    server: "File_Server_1",
    path: "/data/xyz/temp",
  },
  destination: {
    server: "File_Server_2",
    path: "/data/xyz/temp",
  },
  details: {
    filesToCopy: 174,
    totalSize: 300,
    filesCopied: 100,
    totalSizeCopied: 170,
    timeTaken: 15,
    errors: {
      tranient: 30,
      fatal: 0,
      recoverable: 100,
    },
  },
  runHistory: [
    {
      id: 1325,
      source: {
        server: "File_Server_1",
        path: "/data/xyz/temp",
      },
      destination: {
        server: "File_Server_2",
        path: "/data/xyz/temp",
      },
      protocol: "NFS",
      type: "Migration",
      subType: "Baseline",
      status: "Completed",
      files: "150",
      size: "236",
      errors: 0,
    },
    {
      id: 1326,
      source: {
        server: "File_Server_1",
        path: "/data/xyz/temp",
      },
      destination: {
        server: "File_Server_2",
        path: "/data/xyz/temp",
      },
      protocol: "NFS",
      type: "Migration",
      subType: "Incremental",
      status: "Running",
      files: "50/60",
      size: "30/40",
      errors: 0,
    },
  ],
};

const ERRORS_LIST_COLUMN_DEFS = [
  {
    header: "File",
    accessor: "file",
    width: 100,
  },
  {
    header: "Operation",
    accessor: "operation",
    id: "operation",
    width: 100,
  },
  {
    header: "Occurence",
    accessor: "occurence",
    id: "occurence",
    width: 25,
  },
  {
    header: "Code",
    accessor: "code",
    id: "code",
    width: 50,
  },
  {
    header: "Origin",
    accessor: "origin",
    id: "origin",
    width: 50,
  },
  {
    header: "Error Details",
    accessor: "details",
    id: "details",
    width: 250,
    sort: {
      enabled: false,
    },
  },
];

const ERRORS_DUMMY_DATA = [
  {
    file: "temp.txt",
    operation: "Copy",
    occurence: 2,
    code: "#11001",
    origin: "Source",
    details: "Permission denied. Unable to access the file.",
  },
  {
    file: "temp2.txt",
    operation: "Update Metadata",
    occurence: 2,
    code: "#11002",
    origin: "Source",
    details: "Permission denied. Unable to update the file.",
  },
  {
    file: "temp3.txt",
    operation: "Copy",
    occurence: 2,
    code: "#11001",
    origin: "Source",
    details: "Permission denied. Unable to access the file.",
  },
  {
    file: "temp4.txt",
    operation: "Update Metadata",
    occurence: 2,
    code: "#11002",
    origin: "Source",
    details: "Permission denied. Unable to update the file.",
  },
  {
    file: "temp5.txt",
    operation: "Copy",
    occurence: 1,
    code: "#11001",
    origin: "Destination",
    details: "Permission denied. Unable to copy the file.",
  },
];

export {
  JOB_RUN_LIST_COLUMN_DEFS,
  DUMMY_DATA,
  ERRORS_DUMMY_DATA,
  ERRORS_LIST_COLUMN_DEFS,
};

export const GENERATING_REPORT_LABEL = "Generating reports, please wait";
