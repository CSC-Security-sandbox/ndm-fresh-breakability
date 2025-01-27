export abstract class JobUtils {
  static getRedisKey(jobRunId: string, key: string): string {
    return `${jobRunId}-${key}`;
  }
}
