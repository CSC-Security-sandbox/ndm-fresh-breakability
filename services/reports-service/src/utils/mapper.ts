export const BYTES_IN_KILOBYTE = 1024;
export const DECIMAL_BASE = 1000;
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


export const convertBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
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
  if (num === 0) return "0";

  const i = Math.floor(Math.log10(num) / 3);

  const formattedNumber = (num / Math.pow(DECIMAL_BASE, i)).toFixed(2);

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
  // Format size using the convertBytes function
  let formattedSize = convertBytes(sizeValue);

  // Format count using the formatNumbersWithSuffix function
  const formattedCount = formatNumbersWithSuffix(countValue);

  // Combine into the desired output format
  return `size: (${formattedSize}); count: (${formattedCount})`;
};
