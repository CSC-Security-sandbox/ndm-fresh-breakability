export const covertBytes = (bytes: number): string => {
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
  if (num >= 1_00_00_000) {
    return (num / 1_00_00_000).toFixed(2) + " Cr";
  } else if (num >= 1_00_000) {
    return (num / 1_00_000).toFixed(2) + " L";
  } else if (num >= 1_000) {
    return (num / 1_000).toFixed(2) + " K";
  }
  return num.toString();
};

export const formatSizeAndCount = (input: string): string => {
  // Extract size value using regex
  const sizeMatch = input.match(/size\((\d+)\)/);
  const sizeValue = sizeMatch ? parseInt(sizeMatch[1], 10) : 0;

  // Extract count value using regex
  const countMatch = input.match(/count\((\d+)\)/);
  const countValue = countMatch ? parseInt(countMatch[1], 10) : 0;

  // Format size using the formatBytes function (already in your codebase)
  const formattedSize = covertBytes(sizeValue);

  // Format count using the formatLargeNumber function (already in your codebase)
  const formattedCount = formatNumbersWithSuffix(countValue);

  // Combine into the desired output format
  return `size: (${formattedSize}); count: (${formattedCount})`;
};
