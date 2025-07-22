export abstract class JobUtils {
  static getRedisKey(jobRunId: string, key: string): string {
    return `${jobRunId}:${key}`;
  }
}

export function formatBytes(bytes: number, decimals = 2): string {
  const convertedBytes = Math.abs(bytes);
  if (convertedBytes === 0) return '0 B';

  const k = 1000; //   1000 for decimal/SI units (KB, MB, etc.)
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(convertedBytes) / Math.log(k));

  return `${parseFloat((convertedBytes / Math.pow(k, i)).toFixed(decimals))} ${
    sizes[i] || sizes[0]
  }`;
}
