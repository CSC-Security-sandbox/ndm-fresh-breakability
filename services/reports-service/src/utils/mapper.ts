export const BYTES_IN_KILOBYTE = 1024;
export const NUMBER_IN_KILOBYTE = 1000;

export const convertBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= BYTES_IN_KILOBYTE && unitIndex < units.length - 1) {
    size /= BYTES_IN_KILOBYTE;
    unitIndex++;
  }
  return size === Math.floor(size)
    ? `${size?.toFixed(0)} ${units[unitIndex]}`
    : `${size?.toFixed(2)} ${units[unitIndex]}`;
};

export const capitalize = (status: string): string => {
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
};

export const formatSeconds = (seconds: number): string => {
  const days = Math.floor(seconds / 86400);
  const hrs = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = (seconds % 60).toFixed(0);

  if (days > 0) {
    return `${days}d ${hrs}h ${mins}m ${secs}s`;
  } else if (hrs > 0) {
    return `${hrs}h ${mins}m ${secs}s`;
  } else if (mins > 0) {
    return `${mins}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
};

export const formatNumbersWithSuffix = (num: number): string => {
  const LARGE_NUMBER_SUFFIXES = [
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
  if (num === 0) return "0";

  const i = Math.floor(Math.log10(num) / 3);

  const formattedNumber = (num / Math.pow(NUMBER_IN_KILOBYTE, i)).toFixed(2);

  return `${parseFloat(formattedNumber)}${LARGE_NUMBER_SUFFIXES[i]}`;
};

export const formatSizeAndCount = (input: string): string => {
  // Extract size value using regex
  const sizeMatch = input.match(/size\((\d+)\)/);
  const sizeValue = sizeMatch ? parseInt(sizeMatch[1], 10) : 0;

  // Extract count value using regex
  const countMatch = input.match(/count\((\d+)\)/);
  const countValue = countMatch ? parseInt(countMatch[1], 10) : 0;

  // Format size using the formatBytes function (already in your codebase)
  const formattedSize = convertBytes(sizeValue);

  // Format count using the formatLargeNumber function (already in your codebase)
  const formattedCount = formatNumbersWithSuffix(countValue);

  // Combine into the desired output format
  return `size: (${formattedSize}); count: (${formattedCount})`;
};
