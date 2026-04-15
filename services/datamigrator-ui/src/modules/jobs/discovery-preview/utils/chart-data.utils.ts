import { DataItemType, FileInfo, ProcessedData } from "@/types/app.type";
import {
  ACCESS_TIME_COUNT_PREFIX,
  ACCESS_TIME_SIZE_PREFIX,
  CREATION_TIME_COUNT_PREFIX,
  CREATION_TIME_SIZE_PREFIX,
  DECIMAL_BASE,
  FILES_AND_DIRECTORIES_DEPTH,
  FILE_COUNT_PREFIX,
  FILE_SIZE_PREFIX,
  FileSystemCategory,
  FileSystemSubCategory,
  LARGE_NUMBER_SUFFIXES,
  MODIFICATION_TIME_COUNT_PREFIX,
  MODIFICATION_TIME_SIZE_PREFIX,
  SIMPLIFIED_BYTE_UNITS,
  ValueType,
} from "@modules/jobs/discovery-preview/constants/preview.constants";
import {
  getRegExp,
  StringComparisonPattern,
} from "@modules/jobs/discovery-preview/string-comparison.enum";
import { sortByUnitAndValue } from "@modules/jobs/discovery-preview/utils/preview.utils";
import { BYTES_IN_KILOBYTE } from "@modules/jobs/discovery-preview/constants/preview.constants";

/* This convert bytes to MB */
const toMB = (value: number): number => {
  return parseFloat(
    (value / (BYTES_IN_KILOBYTE * BYTES_IN_KILOBYTE)).toFixed(2)
  );
};

const covertBytes = (bytes: number): string => {
  const numBytes = Number(bytes);
  if (isNaN(numBytes) || numBytes === 0) return "0 B";
  let size = numBytes;
  let unitIndex = 0;
  while (
    size >= BYTES_IN_KILOBYTE &&
    unitIndex < SIMPLIFIED_BYTE_UNITS.length - 1
  ) {
    size /= BYTES_IN_KILOBYTE;
    unitIndex++;
  }
  return size === Math.floor(size)
    ? `${size?.toFixed(0)} ${SIMPLIFIED_BYTE_UNITS[unitIndex]}`
    : `${size?.toFixed(2)} ${SIMPLIFIED_BYTE_UNITS[unitIndex]}`;
};

// Generic function to extract chart data based on filtering criteria
export function extractChartData(
  jsonData: DataItemType[],
  filterOptions: {
    category: string;
    valueType?: string;
    subCategoryPrefix?: string;
  },
  valueTransform?: (value: number) => number,
  prefixToRemove?: string
): ProcessedData {
  // Filter data based on provided criteria
  let filteredData = jsonData?.filter((item) => {
    // Always filter by category
    const categoryMatch = item.category === filterOptions.category;

    // Optionally filter by valueType
    const valueTypeMatch = filterOptions.valueType
      ? item["valueType"] === filterOptions.valueType
      : true;

    // Optionally filter by subCategory prefix
    const prefixMatch = filterOptions.subCategoryPrefix
      ? item.sub_category.startsWith(filterOptions.subCategoryPrefix)
      : true;

    return categoryMatch && valueTypeMatch && prefixMatch;
  });

  // Extract and transform values
  const data = filteredData?.map((item) => {
    const value = item.value as number;
    return valueTransform ? valueTransform(value) : value;
  });
  // Extract and process categories
  const categories = filteredData?.map((item) => {
    let category = item.sub_category;
    if (prefixToRemove) {
      category = category.replace(prefixToRemove, "").trim();
    }
    return category;
  });

  return { data, categories };
}

// This function extract data for files as per space used
export function chartDataForFileSize(jsonData: DataItemType[]): ProcessedData {
  const extractedChartData = extractChartData(
    jsonData,
    { category: FileSystemCategory.SPACE_USED },
    toMB,
    FILE_SIZE_PREFIX
  );
  return sortByUnitAndValue(
    extractedChartData?.data,
    extractedChartData?.categories
  );
}

// This function extract data for files as per file count
export function chartDataForFileCount(jsonData: DataItemType[]): ProcessedData {
  const extractedChartData = extractChartData(
    jsonData,
    { category: FileSystemCategory.NUMBER_OF_FILES },
    undefined,
    FILE_COUNT_PREFIX
  );
  return sortByUnitAndValue(
    extractedChartData?.data,
    extractedChartData?.categories
  );
}

// This function extract data for files as per file depth
export function chartDataForFileDepth(jsonData: DataItemType[]): ProcessedData {
  return extractChartData(
    jsonData,
    { category: FileSystemCategory.DEPTH, valueType: ValueType.COUNT },
    undefined,
    FILES_AND_DIRECTORIES_DEPTH
  );
}

{
  /* This function extract data for files as per size and as modified */
}
export function chartDataForFileSizeModified(
  jsonData: DataItemType[]
): ProcessedData {
  return extractChartData(
    jsonData,
    {
      category: FileSystemCategory.MODIFIED,
      valueType: ValueType.SIZE,
      subCategoryPrefix: MODIFICATION_TIME_SIZE_PREFIX,
    },
    toMB,
    MODIFICATION_TIME_SIZE_PREFIX + " "
  );
}

{
  /* This function extract data for files as per count and as modified */
}
export function chartDataForFileCountModified(
  jsonData: DataItemType[]
): ProcessedData {
  return extractChartData(
    jsonData,
    {
      category: FileSystemCategory.MODIFIED,
      valueType: ValueType.COUNT,
      subCategoryPrefix: MODIFICATION_TIME_COUNT_PREFIX,
    },
    undefined,
    MODIFICATION_TIME_COUNT_PREFIX + " "
  );
}

{
  /* This function extract data for files as per size and as created */
}
export function chartDataForFileSizeCreated(
  jsonData: DataItemType[]
): ProcessedData {
  return extractChartData(
    jsonData,
    {
      category: FileSystemCategory.CREATED,
      valueType: ValueType.SIZE,
      subCategoryPrefix: CREATION_TIME_SIZE_PREFIX,
    },
    toMB,
    CREATION_TIME_SIZE_PREFIX
  );
}

{
  /* This function extract data for files as per count and as created */
}
export function chartDataForFileCountCreated(
  jsonData: DataItemType[]
): ProcessedData {
  return extractChartData(
    jsonData,
    {
      category: FileSystemCategory.CREATED,
      valueType: ValueType.COUNT,
      subCategoryPrefix: CREATION_TIME_COUNT_PREFIX,
    },
    undefined,
    CREATION_TIME_COUNT_PREFIX
  );
}

{
  /* This function extract data for files as per size and access time */
}
export function chartDataForFileSizeAccessTime(
  jsonData: DataItemType[]
): ProcessedData {
  return extractChartData(
    jsonData,
    {
      category: FileSystemCategory.ACCESS_TIME,
      valueType: ValueType.SIZE,
      subCategoryPrefix: ACCESS_TIME_SIZE_PREFIX,
    },
    toMB,
    ACCESS_TIME_SIZE_PREFIX
  );
}

{
  /* This function extract data for files as per count and access time */
}
export function chartDataForFileCountAccessTime(
  jsonData: DataItemType[]
): ProcessedData {
  return extractChartData(
    jsonData,
    {
      category: FileSystemCategory.ACCESS_TIME,
      valueType: ValueType.COUNT,
      subCategoryPrefix: ACCESS_TIME_COUNT_PREFIX,
    },
    undefined,
    ACCESS_TIME_COUNT_PREFIX
  );
}

{
  /* This function extract data for files by access time */
}
export function chartDataForAccessTime(
  jsonData: DataItemType[]
): ProcessedData {
  return extractChartData(jsonData, {
    category: FileSystemCategory.ACCESS_TIME,
    valueType: ValueType.SIZE,
  });
}

{
  /* This creates a Map out of report data that have count for top file extentions and total size as well */
}
export const createSummaryMap = (
  jsonData: DataItemType[]
): Record<string, number> => {
  const summary: Record<string, number> = {};
  let totalSizeMB = 0;

  jsonData?.forEach(({ value, category, sub_category }) => {
    if (category === FileSystemCategory.TOP_FILE_EXTENSIONS) {
      // Extract the size value using regex
      const sizeMatch = value
        .toString()
        .match(getRegExp(StringComparisonPattern.SIZE_EXTRACTION));
      const sizeValue = sizeMatch ? parseInt(sizeMatch[1], 10) : 0;
      summary["(MiB) " + sub_category] =
        (summary[sub_category] || 0) + toMB(sizeValue);
    }

    if (
      category === FileSystemCategory.TOP_5_FILE_EXTENSIONS_SUMMERY &&
      sub_category === FileSystemSubCategory.TOP_5_FILE_EXTENSIONS_TOTAL
    ) {
      const sizeMatch = (value !== null && value !== undefined
        ? value.toString()
        : ""
      ).match(getRegExp(StringComparisonPattern.SIZE_EXTRACTION));
      const sizeValue = sizeMatch ? parseInt(sizeMatch[1], 10) : 0;
      totalSizeMB = toMB(typeof sizeValue === "number" ? sizeValue : 0);
    }
  });
  summary["total size (MiB)"] = parseFloat(totalSizeMB.toFixed(2));

  return summary;
};

{
  /* This function extract data files will longest names */
}
export function longestFileNames(
  jsonData: { value: string | number; category: string; sub_category: string }[]
): { fileName: string }[] {
  const longestFileEntry = jsonData?.find(
    (item) =>
      item.category === FileSystemCategory.BIGGEST &&
      item.sub_category === FileSystemSubCategory.TOP_5_LONGEST_FILE_PATH
  );

  if (!longestFileEntry || typeof longestFileEntry.value !== ValueType.STRING)
    return [];

  return longestFileEntry.value
    .toString()
    .split(";")
    .map((entry) => ({
      fileName: entry.split(" (")[0].trim(),
    }));
}

{
  /* This function extract data files will biggest sizes */
}
export function extractBiggestFiles(
  jsonData: { value: string | number; category: string; sub_category: string }[]
) {
  const biggestFileEntry = jsonData?.find(
    (item) =>
      item.category === FileSystemCategory.BIGGEST &&
      item.sub_category === FileSystemSubCategory.TOP_5_BIGGEST_FILE_NAMES
  );

  if (!biggestFileEntry || typeof biggestFileEntry.value !== ValueType.STRING)
    return [];

  return biggestFileEntry.value
    .toString()
    .split(";")
    .map((entry) => {
      const match = entry.match(
        getRegExp(StringComparisonPattern.FILE_NAME_SIZE)
      );
      if (!match) return null;
      return {
        fileName: match[1].trim(),
        fileSize: covertBytes(Number(match[2])),
      };
    })
    .filter(Boolean);
}

{
  /* This function extract data directories that are max nested */
}
export function extractLongestDirectoryPaths(data: DataItemType[]): FileInfo[] {
  const longestDirPaths = data?.find(
    (item: DataItemType) =>
      item.category === FileSystemCategory.BIGGEST &&
      item.sub_category === FileSystemSubCategory.TOP_5_LONGEST_DIRECTORY_PATH
  );
  if (!longestDirPaths) return [];
  let longestPathCounts = (longestDirPaths?.value as string)
    ?.split(";")
    ?.map((entry: string) => {
      const openParenIndex = entry.lastIndexOf("(");
      const closeParenIndex = entry.lastIndexOf(")");

      if (
        openParenIndex !== -1 &&
        closeParenIndex !== -1 &&
        openParenIndex < closeParenIndex &&
        !isNaN(
          parseInt(entry.substring(openParenIndex + 1, closeParenIndex), 10)
        )
      ) {
        return {
          directoryPath: entry.substring(0, openParenIndex).trim(),
          length: parseInt(
            entry.substring(openParenIndex + 1, closeParenIndex),
            10
          ),
        };
      }
      return null;
    })
    .filter(Boolean) as FileInfo[];
  return longestPathCounts;
}

{
  /* This function extract maximum and average values */
}
const getMaxValue = (data: DataItemType[], maxType: FileSystemSubCategory, avgType: FileSystemSubCategory) => {
  const maxItem = data?.find(
    (item: DataItemType) =>
      item.category === FileSystemCategory.MAXIMUM_VALUES &&
      item.sub_category === maxType
  );
  
  const avgItem = data?.find(
    (item: DataItemType) =>
      item.category === FileSystemCategory.AVERAGE_VALUES &&
      item.sub_category === avgType
  );
  const maxValue = maxItem ? (maxItem?.value as number) : 0;
  const avgValue = avgItem ? (avgItem?.value as number) : 0;

  return { maxValue, avgValue };
}

{
  /* This function extract data files with max and average of depth */
}
export function extractAverageMaxDepth(jsonData: DataItemType[]) {
  const result = getMaxValue(jsonData, FileSystemSubCategory.MAX_DEPTH, FileSystemSubCategory.AVG_DEPTH);
  return { avgDepth: result.avgValue, maxDepth: result.maxValue };
}

{
  /* This function extract data files with max and average longest path */
}
export function extractMaxAvgFilePath(data: DataItemType[]): {
  maxPath: number;
  avgPath: number;
} {
  const result = getMaxValue(data, FileSystemSubCategory.MAX_NAME_LENGTH, FileSystemSubCategory.AVG_NAME_LENGTH);
  return { maxPath: result.maxValue, avgPath: result.avgValue };
}

{
  /* This function extract value for max and average of file size */
}
export function extractMaxAvgFileSize(data: DataItemType[]): {
  maxFileSize: number;
  avgFileSize: number;
} {
  const result = getMaxValue(data, FileSystemSubCategory.MAX_FILE_SIZE, FileSystemSubCategory.AVG_FILE_SIZE);
  return { maxFileSize: result.maxValue, avgFileSize: result.avgValue };
}

{
  /* These are simply value extractors for overview dougnut chart and legend */
}
export function extractSystemFileStatAndDirectories(data: DataItemType[]) {
  const regularFiles =
    data?.find(
      (item: DataItemType) =>
        item.sub_category === FileSystemSubCategory.REGULAR_FILES
    )?.value || 0;
  const symbolicLinks =
    data?.find(
      (item: DataItemType) =>
        item.sub_category === FileSystemSubCategory.SYMBOLIC_LINKS_COUNT
    )?.value || 0;
  const totalCount =
    data?.find(
      (item: DataItemType) =>
        item.sub_category === FileSystemSubCategory.TOTAL_COUNT
    )?.value || 0;
  const totalSpaceUsed =
    data?.find(
      (item: DataItemType) =>
        item.sub_category === FileSystemSubCategory.TOTAL_SPACE_USED
    )?.value || 0;
  const totalSpaceRegularFiles =
    data?.find(
      (item: DataItemType) =>
        item.sub_category === FileSystemSubCategory.TOTAL_SPACE_FOR_REGULAR_FILES
    )?.value || 0;
  const directories =
    data?.find(
      (item: DataItemType) =>
        item.sub_category === FileSystemSubCategory.TOTAL_DIRECTORIES
    )?.value || 0;
  const jobRunStatus =
    data?.find(
      (item: DataItemType) => item.sub_category === FileSystemSubCategory.STATUS
    )?.value || 0;
  const scanTime =
    data?.find(
      (item: DataItemType) =>
        item.sub_category === FileSystemSubCategory.TOTAL_TIME
    )?.value || 0;
  const fileServerName =
    data?.find(
      (item: DataItemType) =>
        item.sub_category === FileSystemSubCategory.FILE_SERVER_NAME
    )?.value || data?.find(
      (item: DataItemType) =>
        item.sub_category === FileSystemSubCategory.CONFIG_NAME
    )?.value || "";
  const fileServerPath =
    data?.find(
      (item: DataItemType) => item.sub_category === FileSystemSubCategory.PATH
    )?.value || 0;
  // Fixed: Look for correct category AND sub_category, return empty string instead of 0
  const fileServerProtocol =
    data?.find(
      (item: DataItemType) =>
        item.category === "File Server Info" &&
        item.sub_category === FileSystemSubCategory.PROTOCOL
    )?.value || "";
  const hardLinks =
    data?.find(
      (item: DataItemType) =>
        item.sub_category === FileSystemSubCategory.HARD_LINKS_COUNT
    )?.value || 0;
  const junctionCount =
    data?.find(
      (item: DataItemType) =>
        item.sub_category === FileSystemSubCategory.JUNCTIONS_COUNT
    )?.value || 0;
  const volumeMountCount =
    data?.find(
      (item: DataItemType) =>
        item.sub_category === FileSystemSubCategory.VOLUME_MOUNT_COUNT
    )?.value || 0;
    const adsFilesRaw =
      data?.find(
        (item: DataItemType) =>
          item.category === FileSystemCategory.ALTERNATIVE_DATA_STREAMS &&
          item.sub_category === FileSystemSubCategory.ADS_FILES
      )?.value || 0;
    const adsFiles = typeof adsFilesRaw === 'string' 
      ? adsFilesRaw.split(';').filter(p => p.trim()).length 
      : adsFilesRaw;
    const adsDirectoriesRaw =
      data?.find(
        (item: DataItemType) =>
          item.category === FileSystemCategory.ALTERNATIVE_DATA_STREAMS &&
          item.sub_category === FileSystemSubCategory.ADS_DIRECTORIES
      )?.value || 0;
    const adsDirectories = typeof adsDirectoriesRaw === 'string'
      ? adsDirectoriesRaw.split(';').filter(p => p.trim()).length
      : adsDirectoriesRaw;
  return {
    regularFiles,
    symbolicLinks,
    hardLinks,
    junctionCount,
    volumeMountCount,
    totalCount,
    totalSpaceUsed,
    totalSpaceRegularFiles,
    directories,
    jobRunStatus,
    scanTime,
    fileServerName,
    fileServerPath,
    fileServerProtocol,
    adsFiles, 
    adsDirectories, 
  };
}

{
  /* This function smartly convert bytes to KiB, MiB, GiB, TiB, PiB, EiB, ZiB or YiB */
}
export function formatBytes(bytes: number, decimals = 2): string {

const numBytes = Number(bytes);
  if (isNaN(numBytes) || numBytes === 0) return "0 B";

  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"];
  let size = numBytes;
  let i = 0;

  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }

  return size % 1 === 0
    ? `${size.toFixed(0)} ${units[i]}`
    : `${size.toFixed(decimals)} ${units[i]}`;
}

{
  /* This function smartly convert numbers to K, M, B, T, Q, Quint, Sext, Sept */
}
export function formatLargeNumber(num: number, decimals = 2): string {
  if (Number(num) === 0) return "0";

  const i = Math.floor(Math.log10(Math.abs(num)) / 3);

  if (i <= 0) {
    const parsed = parseFloat(num.toFixed(decimals));
    return `${parsed}`;
  }

  const formattedNumber = (num / Math.pow(DECIMAL_BASE, i)).toFixed(decimals);

  return `${parseFloat(formattedNumber)}${LARGE_NUMBER_SUFFIXES[i] ?? ""}`;
}
