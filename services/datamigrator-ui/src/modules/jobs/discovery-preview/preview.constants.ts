import {
  chartDataForFileCount,
  chartDataForFileCountAccessTime,
  chartDataForFileCountCreated,
  chartDataForFileCountModified,
  chartDataForFileDepth,
  chartDataForFileSize,
  chartDataForFileSizeAccessTime,
  chartDataForFileSizeCreated,
  chartDataForFileSizeModified
} from '@modules/jobs/discovery-preview/preview.decorators';
import {DataItemType} from '../../../types/app.type.ts';

/**
 * Enum for value types
 */
export enum ValueType {
  COUNT = "count",
  SIZE = "size",
  NUMBER = "number",
  STRING = "string",
}

/**
 * Enum for file system categories
 */
export enum FileSystemCategory {
  FILE_SYSTEM_STATS = "File System Stats",
  SPACE_USED = "Space Used",
  NUMBER_OF_FILES = "Number of Files",
  DEPTH = "Depth",
  MODIFIED = "Modified",
  CREATED = "Created",
  ACCESS_TIME = "Access Time",
  BIGGEST = "Biggest",
  TOP_FILE_EXTENSIONS = "Top File Extensions (with file Capacity and Count)",
  MAXIMUM_VALUES = "Maximum Values",
  JOB_RUN_STATS = "Job Run Stats",
  FILE_SERVER_INFO = "File Server Info",
}

/**
 * Enum for file system subcategories
 */
export enum FileSystemSubCategory {
  // File System Stats subcategories
  REGULAR_FILES = "Regular Files",
  SYMBOLIC_LINKS = "Symbolic Links",
  SPECIAL_FILES = "Special Files",
  TOTAL_COUNT = "Total Count",
  TOTAL_SPACE_FOR_REGULAR_FILES = "Total Space for Regular Files",
  TOTAL_SPACE_FOR_DIRECTORIES = "Total Space for Directories",
  TOTAL_SPACE_USED = "Total Space Used",

  // Maximum Values subcategories
  MAX_FILE_SIZE = "max_file_size",
  MAX_NAME_LENGTH = "max_name_length",
  TOTAL_DIRECTORIES = "total_directories",

  // Job Run Stats subcategories
  TOTAL_TIME = "Total Time",
  STATUS = "Status",

  // File Server Info subcategories
  PATH = "Path",
  PROTOCOL = "Protocol",
  CONFIG_NAME = "Config Name",

  // Biggest subcategories
  TOP_5_LONGEST_FILE_NAMES = "Top 5 Longest File Names",
  TOP_5_LONGEST_DIRECTORY_NAMES = "Top 5 Longest Directory Names",
  TOP_5_BIGGEST_FILE_NAMES = "Top 5 Biggest File Names",
  TOP_5_LONGEST_DIRECTORY_PATH = "Top 5 Longest Directory Path",
  TOP_5_LONGEST_FILE_PATH = "Top 5 Longest File Path",
  TOP_5_BIGGEST_DIRECTORY_WITH_COUNT = "Top 5 Biggest Directory With Count",
  TOP_5_BIGGEST_DIRECTORY_WITH_CAPACITY = "Top 5 Biggest Directory With Capacity",
  FILE_PATH_SUMMARY = "File Path Summary",
}

/**
 * Enum for byte units
 */
export enum ByteUnits {
  BYTES = "B",
  KB = "KiB",
  MB = "MiB",
  GB = "GiB",
  TB = "TiB",
  PB = "PiB",
  EB = "EiB",
  ZB = "ZiB",
  YB = "YiB",
}

/**
 * Array of byte units in order
 */
export const BYTE_UNITS = [
  ByteUnits.BYTES,
  ByteUnits.KB,
  ByteUnits.MB,
  ByteUnits.GB,
  ByteUnits.TB,
  ByteUnits.PB,
  ByteUnits.EB,
  ByteUnits.ZB,
  ByteUnits.YB,
];

/**
 * Simplified array of byte units for basic conversions
 */
export const SIMPLIFIED_BYTE_UNITS = [
  "B",
  "KiB",
  "MiB",
  "GiB",
  "TiB",
  "PiB",
  "EiB",
  "ZiB",
  "YiB"
];
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

export const OPTIONS_FOR_CHART_TOGGLE = [
  { label: "File Count", value: "fileCount" },
  { label: "File Size", value: "fileSize" },
];

/**
 * Array of large number suffixes in order
 */
export const LARGE_NUMBER_SUFFIXES = ["", "K", "M", "B", "T", "Q", "Quint", "Sext", "Sept"];

/**
 * String constants for file size and count prefixes
 */
export const FILE_SIZE_PREFIX = "Capacity with File Size: ";
export const FILE_COUNT_PREFIX = "File Count with File Size: ";
export const MODIFICATION_TIME_SIZE_PREFIX = "Capacity with Modification Time";
export const MODIFICATION_TIME_COUNT_PREFIX = "File Count with Modification Time";
export const CREATION_TIME_SIZE_PREFIX = "Capacity with Creation Time";
export const CREATION_TIME_COUNT_PREFIX = "File Count with Creation Time";
export const ACCESS_TIME_SIZE_PREFIX = "Capacity with Access Time";
export const ACCESS_TIME_COUNT_PREFIX = "File Count with Access Time";
export const FILES_AND_DIRECTORIES_DEPTH = "Files and Directory with depth:";

/**
 * Constant for byte conversion (1000 bytes = 1 KB)
 */
export const BYTES_IN_KILOBYTE = 1024;
export const DECIMAL_BASE = 1000;