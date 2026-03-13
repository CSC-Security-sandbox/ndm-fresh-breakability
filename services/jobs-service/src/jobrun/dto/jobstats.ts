export interface JobRunStats {
  lastRefreshed?: Date;
  fileCount: string;
  directories: string;
  totalSize: string;
  errors: { errorType?: string; errortype?: string; count: number }[];
}
