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
  errors: JobRunErrorCount[];
  sourceServer?: ServerSnapshot;
  destinationServer?: ServerSnapshot;
}