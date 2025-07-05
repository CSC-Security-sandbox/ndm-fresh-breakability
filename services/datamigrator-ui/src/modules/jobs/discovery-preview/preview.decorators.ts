import { DataItemType, FileInfo, ProcessedData } from "@/types/app.type";

{
  /* This convert bytes to MB */
}
const toMB = (value: number): number => {
  return parseFloat((value / (1000 * 1000)).toFixed(2));
};

const covertBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1000 && unitIndex < units.length - 1) {
    size /= 1000;
    unitIndex++;
  }
  return size === Math.floor(size)
      ? `${size?.toFixed(0)} ${units[unitIndex]}`
      : `${size?.toFixed(2)} ${units[unitIndex]}`;
};


{
  /* This function extract data for files as per space used */
}
export function chartDataForFileSize(jsonData: DataItemType[]): ProcessedData {
  const filteredData = jsonData?.filter(
    (item) => item.category === "Space Used" && typeof item.value === "number"
  );

  const data = filteredData?.map((item) => toMB(item.value as number));
  const categories = filteredData?.map((item) =>
    item.sub_category.replace("Capacity with File Size: ", "").trim()
  );

  return { data, categories };
}

{
  /* This function extract data for files as per file count */
}
export function chartDataForFileCount(jsonData: DataItemType[]): ProcessedData {
  const filteredData = jsonData?.filter(
    (item) =>
      item.category === "Number of Files" && typeof item.value === "number"
  );

  const data = filteredData?.map((item) => item.value as number);
  const categories = filteredData?.map((item) =>
    item.sub_category.replace("File Count with File Size: ", "").trim()
  );

  return { data, categories };
}

{
  /* This function extract data for files as per file depth */
}
export function chartDataForFileDepth(jsonData: DataItemType[]): ProcessedData {
  const filteredData = jsonData?.filter(
    (item) => item.category === "Depth" && typeof item.value === "number"
  );

  const data = filteredData?.map((item) => item.value as number);
  const categories = filteredData?.map((item) => item.sub_category.trim());

  return { data, categories };
}

{
  /* This function extract data for files as per size and as modified */
}
export function chartDataForFileSizeModified(
  jsonData: DataItemType[]
): ProcessedData {
  const filteredData = jsonData?.filter(
    (item) =>
      item.category === "Modified" &&
        item['valueType'] === "size" &&
      item.sub_category.startsWith("Capacity with Modification Time")
  );

  const data = filteredData?.map((item) => toMB(item.value as number));
  const categories = filteredData?.map((item) =>
    item.sub_category.replace("Capacity with Modification Time ", "").trim()
  );

  return { data, categories };
}

{
  /* This function extract data for files as per count and as modified */
}
export function chartDataForFileCountModified(
  jsonData: DataItemType[]
): ProcessedData {
  const filteredData = jsonData?.filter(
    (item) =>
      item.category === "Modified" &&
        item['valueType'] === "count" &&
      item.sub_category.startsWith("File Count with Modification Time")
  );

  const data = filteredData?.map((item) => item.value as number);
  const categories = filteredData?.map((item) =>
    item.sub_category.replace("File Count with Modification Time ", "").trim()
  );

  return { data, categories };
}

{
  /* This function extract data for files as per size and as created */
}
export function chartDataForFileSizeCreated(
  jsonData: DataItemType[]
): ProcessedData {
  const filteredData = jsonData?.filter(
    (item) =>
      item.category === "Created" &&
      item['valueType'] === "size" &&
      item.sub_category.startsWith("Capacity with Creation Time")
  );

  const data = filteredData?.map((item) => toMB(item.value as number));
  const categories = filteredData?.map((item) =>
    item.sub_category.replace("Capacity with Creation Time", "").trim()
  );

  return { data, categories };
}

{
  /* This function extract data for files as per count and as created */
}
export function chartDataForFileCountCreated(
  jsonData: DataItemType[]
): ProcessedData {
  const filteredData = jsonData?.filter(
    (item) =>
      item.category === "Created" &&
       item['valueType'] === "count" &&
      item.sub_category.startsWith("File Count with Creation Time")
  );
  const data = filteredData?.map((item) => item.value as number);
  const categories = filteredData?.map((item) =>
    item.sub_category.replace("File Count with Creation Time", "").trim()
  );
  return { data, categories };
}

{
  /* This function extract data for files as per count and as created */
}
export function chartDataForFileSizeAccessTime(
    jsonData: DataItemType[]
): ProcessedData {
  const filteredData = jsonData?.filter(
      (item) =>
          item.category === "Access Time" &&
          item['valueType'] === "size" &&
          item.sub_category.startsWith("Capacity with Access Time")
  );

  const data = filteredData?.map((item) => toMB(item.value as number));
  const categories = filteredData?.map((item) => item.sub_category.replace("Capacity with Access Time", "").trim()
  );

  return { data, categories };
}

{
  /* This function extract data for files as per count and as created */
}
export function chartDataForFileCountAccessTime(
    jsonData: DataItemType[]
): ProcessedData {
  const filteredData = jsonData?.filter(
      (item) =>
          item.category === "Access Time" &&
          item['valueType'] === "count" &&
          item.sub_category.startsWith("File Count with Access Time")
  );
  const data = filteredData?.map((item) => item.value as number);
  const categories = filteredData?.map((item) =>
      item.sub_category.replace("File Count with Access Time", "").trim()
  );

  return { data, categories };
}
export function chartDataForAccessTime(
  jsonData: DataItemType[]
): ProcessedData {
  const filteredData = jsonData?.filter(
    (item) => item.category === "Access Time" && item['valueType'] === "size"
  );

  const data = filteredData?.map((item) => item.value as number);
  const categories = filteredData?.map((item) => item.sub_category.trim());

  return { data, categories };
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
    if (category === "Top File Extensions") {
      // Extract the size value using regex
      const sizeMatch = value.toString().match(/size\((\d+)\)/);
      const sizeValue = sizeMatch ? parseInt(sizeMatch[1], 10) : 0;
      summary[sub_category +' (MB)'] = (summary[sub_category] || 0) + toMB(sizeValue) ;
    }

    if (
      category === "File System Stats" &&
      sub_category === "Total Space Used"
    ) {
      totalSizeMB = toMB(typeof value === 'number' ? value :0);
    }
  });

  summary["total size (MB)"] = parseFloat(totalSizeMB.toFixed(2));

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
      item.category === "Biggest" && item.sub_category === "Top 5 Longest File Names"
  );

  if (!longestFileEntry || typeof longestFileEntry.value !== "string")
    return [];

  return longestFileEntry.value.split(";").map((entry) => ({
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
      item.category === "Biggest" && item.sub_category === "Top 5 Biggest File Names"
  );

  if (!biggestFileEntry || typeof biggestFileEntry.value !== "string")
    return [];

  return biggestFileEntry.value
    .split(";")
    .map((entry) => {
      const match = entry.match(/(.+?) \((\d+)\)/);
      if (!match) return null;
      return { fileName: match[1].trim(), fileSize: covertBytes(Number(match[2])) };
    })
    .filter(Boolean);
}

{
  /* This function extract data directories that are max nested */
}
export function extractLongestDirectoryPaths(data: DataItemType[]): FileInfo[] {
  const longestDirPaths = data?.find(
    (item: DataItemType) =>
      item.category === "Biggest" &&
      item.sub_category === "Top 5 Longest Directory Path"
  );
  if (!longestDirPaths) return [];
 let longestPathCounts=  (longestDirPaths?.value as string)
     ?.split(";")
     ?.map((entry: string) => {
       const match = entry.match(/\/([^/]+) \((\d+)\)$/);
       if (match) {
         return {
           fileName: match[1],
           fileSize: parseInt(match[2], 10),
         };
       }
       return null;
     })
     .filter(Boolean) as FileInfo[];
  return longestPathCounts;
}

{
  /* This function extract data files with max and average of depth */
}
export function extractAverageMaxDepth(jsonData: DataItemType[]) {
  const depthData = jsonData?.filter(
    (item: DataItemType) => item.category === "Depth"
  );
  if (depthData?.length === 0) {
    return { avgDepth: 0, maxDepth: 0 };
  }

  const maxDepth = Math.max(
    ...depthData.map((item: DataItemType) => item.value as number)
  );

  const total = depthData?.reduce(
    (sum: number, item: DataItemType) => sum + (item.value as number),
    0
  );
  const avgDepth = parseFloat((total / depthData?.length).toFixed(1));

  return { avgDepth, maxDepth };
}

{
  /* This function extract data files with max and average longest path */
}
export function extractMaxAvgFilePath(data: DataItemType[]): {
  maxPath: number;
  avgPath: number;
} {
   const filePathLengths = data
    ?.filter((item: DataItemType) => item.sub_category === "Top 5 Longest File Path")
    ?.map((item: DataItemType) =>
      (item.value as string)
        .split(";")
        .map((path: string) => {
          const match = path.match(/\((\d+)\)/);
         const countOfPath= match ? parseInt(match[1], 10) : null;
         return countOfPath
        })
    );
  const allLengths = filePathLengths?.flat();
  if (allLengths?.length === 0) return { maxPath: 0, avgPath: 0 };

  const maxPath = Math.max(...allLengths);
  const avgPath =
    allLengths?.reduce((acc: number, length: number) => acc + length, 0) /
    allLengths?.length;

  return {
    maxPath,
    avgPath,
  };
}

{
  /* This function extract value for max and average of file size */
}
export function extractMaxAvgFileSize(data: DataItemType[]): {
  maxFileSize: number;
  avgFileSize: number;
} {
  const fileSizeValues = data
    ?.filter((item: DataItemType) => item.sub_category === "Top 5 Biggest File Names")
    ?.map((item: DataItemType) =>
      (item.value as string).split(";").map((file: string) => {
        const match = file.trim().match(/\((\d+)\)/);
        return match ? parseInt(match[1], 10) : 0;
      })
    );

  const allFileSizes = fileSizeValues?.flat();

  if (allFileSizes?.length === 0) return { maxFileSize: 0, avgFileSize: 0 };

  const maxFileSize = Math.max(...allFileSizes);
  const avgFileSize =
    allFileSizes?.reduce((acc: number, size: number) => acc + size, 0) /
    allFileSizes?.length;

  return {
    maxFileSize,
    avgFileSize,
  };
}

{
  /* These are simply value extractors for overview dougnut chart and legend */
}
export function extractSystemFileStatAndDirectories(data: DataItemType[]) {
  const regularFiles =
    data?.find((item: DataItemType) => item.sub_category === "Regular Files")
      ?.value || 0;
  const symbolicLinks =
    data?.find((item: DataItemType) => item.sub_category === "Symbolic Links")
      ?.value || 0;
  const totalCount =
    data?.find((item: DataItemType) => item.sub_category === "Total Count")
      ?.value || 0;
  const totalSpaceUsed =
    data?.find((item: DataItemType) => item.sub_category === "Total Space Used")
      ?.value || 0;
  const directories =
    data?.find(
      (item: DataItemType) => item.sub_category === "total_directories"
    )?.value || 0;
  const jobRunStatus =
    data?.find((item: DataItemType) => item.sub_category === "Status")?.value ||
    0;
  const scanTime =
    data?.find((item: DataItemType) => item.sub_category === "Total Time")
      ?.value || 0;
  const fileServerName =
    data?.find((item: DataItemType) => item.sub_category === "Config Name")
      ?.value || 0;
  const fileServerPath =
    data?.find((item: DataItemType) => item.sub_category === "Path")?.value ||
    0;
  const fileServerProtocol =
    data?.find((item: DataItemType) => item.sub_category === "Protocol")
      ?.value || 0;
  return {
    regularFiles,
    symbolicLinks,
    totalCount,
    totalSpaceUsed,
    directories,
    jobRunStatus,
    scanTime,
    fileServerName,
    fileServerPath,
    fileServerProtocol,
  };
}

{
  /* This function smartly convert bytes to KB, MB, GB, TB, PB, EB, ZB or YB */
}
export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1000;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${
    sizes[i] || sizes[0]
  }`;
}

{
  /* This function smartly convert numbers to K, M, B, T, Q, Quint, Sext, Sept */
}
export function formatLargeNumber(num: number, decimals = 2): string {
  if (num === 0) return "0";

  const sizes = ["", "K", "M", "B", "T", "Q", "Quint", "Sext", "Sept"];
  const i = Math.floor(Math.log10(num) / 3);

  const formattedNumber = (num / Math.pow(1000, i)).toFixed(decimals);

  return `${parseFloat(formattedNumber)}${sizes[i]}`;
}
