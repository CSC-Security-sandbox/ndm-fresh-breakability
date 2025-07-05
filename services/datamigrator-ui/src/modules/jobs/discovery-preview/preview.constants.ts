import { DataItemType } from "@/app/type.interface";
import {
  chartDataForAccessTime,
  chartDataForFileCount, chartDataForFileCountAccessTime,
  chartDataForFileCountCreated,
  chartDataForFileCountModified,
  chartDataForFileDepth,
  chartDataForFileSize, chartDataForFileSizeAccessTime,
  chartDataForFileSizeCreated,
  chartDataForFileSizeModified
} from '@modules/jobs/discovery-preview/preview.decorators';

export const availableChartColors = [
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "chart-6",
  "chart-7",
  "chart-8",
  "chart-9",
  "chart-10",
  "chart-11",
];

export const CHART_MAPER = (jobData: DataItemType[]) => [
  {
    label: "File Count and Size",
    haveToggle: true,
    toggleOptions: [
      { label: "File Count", value: "fileCount" },
      { label: "File Size", value: "fileSize" },
    ],
    data: chartDataForFileCount(jobData).data,
    categories: chartDataForFileCount(jobData).categories,
    countData: chartDataForFileCount(jobData).data,
    countCategories: chartDataForFileCount(jobData).categories,
    sizeData: chartDataForFileSize(jobData).data,
    sizeCategories: chartDataForFileSize(jobData).categories,
  },
  {
    label: "Directory Entries",
    haveToggle: false,
    toggleOptions: [],
    data: [],
    categories: [],
    countData: [],
    countCategories: [],
    sizeData: [],
    sizeCategories: [],
  },
  {
    label: "Depth",
    haveToggle: false,
    toggleOptions: [],
    data: chartDataForFileDepth(jobData).data,
    categories: chartDataForFileDepth(jobData).categories,
    countData: [],
    countCategories: [],
    sizeData: [],
    sizeCategories: [],
  },
  {
    label: "Created",
    haveToggle: true,
    toggleOptions: [],
    data: [],
    categories: [],
    countData: chartDataForFileCountCreated(jobData).data,
    countCategories: chartDataForFileCountCreated(jobData).categories,
    sizeData: chartDataForFileSizeCreated(jobData).data,
    sizeCategories: chartDataForFileSizeCreated(jobData).categories,
  },
  {
    label: "Modified",
    haveToggle: true,
    toggleOptions: [],
    data: [],
    categories: [],
    countData: chartDataForFileCountModified(jobData).data,
    countCategories: chartDataForFileCountModified(jobData).categories,
    sizeData: chartDataForFileSizeModified(jobData).data,
    sizeCategories: chartDataForFileSizeModified(jobData).categories,
  },

  {
    label: "Access Time",
    haveToggle: true,
    toggleOptions: [],
    data: [],
    categories: [],
    countData: chartDataForFileCountAccessTime(jobData).data,
    countCategories: chartDataForFileCountAccessTime(jobData).categories,
    sizeData: chartDataForFileSizeAccessTime(jobData).data,
    sizeCategories: chartDataForFileSizeAccessTime(jobData).categories,
  },
];

export const JOB_REPORT_HEADER_CONSTANTS = [
  {
    label: "Job Run Id",
    value: "1234567",
  },
  {
    label: "File Server",
    value: "File_Server_2",
  },
  {
    label: "Path",
    value: "/System/Volumes/Datasource",
  },
  {
    label: "Report Status",
    value: "Completed (0 errors)",
  },
  {
    label: "Scan Time",
    value: "0",
  },
  {
    label: "Scan Protocol",
    value: "NFS",
  },
];

export const BIGGEST_FILE_SIZE_NAME_COLS = [
  {
    header: "File Name",
    accessor: "fileName",
    id: 1,
    sort: {
      enabled: false,
    },
  },
  {
    header: "File Size",
    accessor: "fileSize",
    id: 2,
  },
];

export const LONGEST_FILE_NAME_COLS = [
  {
    header: "File Name",
    accessor: "fileName",
    id: 1,
  },
];

export const LONGEST_PATH_TABLE_COLUMS = [
  {
    header: "File Name",
    accessor: "fileName",
    id: 1,
    width: 225,
    sort: {
      enabled: false,
    },
  },
  {
    header: "File Size",
    accessor: "fileSize",
    id: 2,
    width: 225,
  },
];

export const OPTIONS_FOR_CHART_TOGGLE = [
  { label: "File Count", value: "fileCount" },
  { label: "File Size", value: "fileSize" },
];
