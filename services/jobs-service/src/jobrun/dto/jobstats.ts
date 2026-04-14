export interface JobRunErrorCount {
  errortype: string;
  count: number;
}

export interface ServerSnapshot {
  serverName: string;
  path: string;
  protocol: string;
  directoryPath?: string;
}

export interface JobRunStats {
  lastRefreshed?: Date;
  fileCount: string;
  directories: string;
  totalSize: string;
  errors: [];
  newlyCopiedCount?: string;
  modifiedCount?: string;
  deletedCount?: string;
  excludedCount?: string;
  totalCopiedSize?: string;
}
