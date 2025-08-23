import {
  chartDataForFileCount,
  chartDataForFileCountAccessTime,
  chartDataForFileCountCreated,
  chartDataForFileCountModified,
  chartDataForFileDepth,
  chartDataForFileSize,
  chartDataForFileSizeAccessTime,
  chartDataForFileSizeCreated,
  chartDataForFileSizeModified,
} from "@modules/jobs/discovery-preview/utils/chart-data.utils";
import { DataItemType } from "@/types/app.type";

export const CHART_MAPER = (jobData: DataItemType[]) => [
  {
    label: "File Count and Space Used",
    haveToggle: true,
    toggleOptions: [
      { label: "File Count", value: "fileCount" },
      { label: "Space Used", value: "fileSize" },
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
    label: "Files and Directories Depth",
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
    header: "File Path",
    accessor: "fileName",
    id: 1,
  },
];

export const LONGEST_PATH_TABLE_COLUMS = [
  {
    header: "Directory Path",
    accessor: "directoryPath",
    id: 1,
    width: 225,
    sort: {
      enabled: false,
    },
  },
  {
    header: "Length",
    accessor: "length",
    id: 2,
    width: 225,
  },
];
