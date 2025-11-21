export enum ValueType {
  COUNT = "count",
  SIZE = "size",
  NUMBER = "number",
  STRING = "string",
}

export enum FileSystemCategory {
  FILE_SYSTEM_STATS = "File System Stats",
  SPACE_USED = "Space Used",
  NUMBER_OF_FILES = "Number of Files",
  DEPTH = "Depth",
  MODIFIED = "Modified",
  CREATED = "Created",
  ACCESS_TIME = "Access Time",
  BIGGEST = "Biggest",
  TOP_FILE_EXTENSIONS = "Top 5 File Extensions (with file Capacity and Count)",
  MAXIMUM_VALUES = "Maximum Values",
  JOB_RUN_STATS = "Job Run Stats",
  FILE_SERVER_INFO = "File Server Info",
  AVERAGE_VALUES = "Average Values",
  TOP_5_FILE_EXTENSIONS_SUMMERY = "Top File Extensions Summary",
  FILE_NAME_TRAILING_SPACES = "Files without extensions and trailing spaces",
}

export enum FileSystemSubCategory {
  // File System Stats subcategories
  REGULAR_FILES = "Regular Files",
  SYMBOLIC_LINKS_COUNT = "Symbolic Links Count",
  SPECIAL_FILES = "Special Files",
  TOTAL_COUNT = "Total Count",
  TOTAL_SPACE_FOR_REGULAR_FILES = "Total Space for Regular Files",
  TOTAL_SPACE_FOR_DIRECTORIES = "Total Space for Directories",
  TOTAL_SPACE_USED = "Total Space Used",

  //Top 5 File Extensions subcategories
  TOP_5_FILE_EXTENSIONS_TOTAL = "Top 5 Extensions Total",

  // Maximum Values subcategories
  MAX_FILE_SIZE = "max_file_size",
  MAX_NAME_LENGTH = "max_name_length",
  TOTAL_DIRECTORIES = "total_directories",
  MAX_DEPTH = "max_depth",

  //Average Values subcategories
  AVG_FILE_SIZE = "avg_file_size",
  AVG_NAME_LENGTH = "avg_name_length",
  AVG_DEPTH = "avg_depth",

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

export const SIMPLIFIED_BYTE_UNITS = [
  "B",
  "KiB",
  "MiB",
  "GiB",
  "TiB",
  "PiB",
  "EiB",
  "ZiB",
  "YiB",
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

export const OPTIONS_FOR_CHART_TOGGLE = [
  { label: "File Count", value: "fileCount" },
  { label: "Space Used", value: "fileSize" },
];

export const LARGE_NUMBER_SUFFIXES = [
  "",
  "K",
  "M",
  "B",
  "T",
  "Q",
  "Quint",
  "Sext",
  "Sept",
];

export const FILE_SIZE_PREFIX = "Capacity with File Size: ";
export const FILE_COUNT_PREFIX = "File Count with File Size: ";
export const MODIFICATION_TIME_SIZE_PREFIX = "Capacity with Modification Time";
export const MODIFICATION_TIME_COUNT_PREFIX =
  "File Count with Modification Time";
export const CREATION_TIME_SIZE_PREFIX = "Capacity with Creation Time";
export const CREATION_TIME_COUNT_PREFIX = "File Count with Creation Time";
export const ACCESS_TIME_SIZE_PREFIX = "Capacity with Access Time";
export const ACCESS_TIME_COUNT_PREFIX = "File Count with Access Time";
export const FILES_AND_DIRECTORIES_DEPTH = "Files and Directory with depth:";
export const BYTES_IN_KILOBYTE = 1024;
export const DECIMAL_BASE = 1000;
