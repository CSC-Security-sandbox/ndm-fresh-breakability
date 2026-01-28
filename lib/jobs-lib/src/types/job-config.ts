import { FileServerDetails } from './file-server';
import { Options } from './options';
import { Serializable } from './serializable';

export class JobConfig implements Serializable {
  jobId: string;
  jobType: string;
  sourceFileServer: FileServerDetails;
  sourcePath: string;
  workerIds?: string[];
  destinationFileServer?: FileServerDetails;
  destinationPath?: string;
  options?:Options;
  skipDelete?: boolean //  Set to true for incremental or cutover jobs. When true, target files will be deleted if they are not present in the source.
  jobRunId?: string; // If set, this is a retry run - skip scan and use failed items from this job run

  constructor(
    jobId: string,
    jobType: string,
    sourceFileServer: FileServerDetails,
    sourcePath: string,
    destinationFileServer?: FileServerDetails,
    destinationPath?: string,
    workerIds?: string[],
    options?: Options,
    skipDelete?: boolean,
    jobRunId?: string
  ) {
    this.jobId = jobId;
    this.jobType = jobType;
    this.sourceFileServer = sourceFileServer;
    this.destinationFileServer = destinationFileServer;
    this.sourcePath = sourcePath;
    this.destinationPath = destinationPath;
    this.workerIds = workerIds;
    this.options = options;
    this.skipDelete = skipDelete;
    this.jobRunId = jobRunId;
  }

  serialize(): string {
    return JSON.stringify(this);
  }

  deserialize(json: string): void {
    const obj = JSON.parse(json);
    this.jobId = obj.jobId;
    this.jobType = obj.jobType;
    this.sourceFileServer = obj.sourceFileServer;
    this.destinationFileServer = obj.destinationFileServer;
    this.sourcePath = obj.sourcePath;
    this.destinationPath = obj.destinationPath;
    this.workerIds = obj.workerIds;
    this.options = obj.options;
    this.skipDelete = obj.skipDelete;
    this.jobRunId = obj.jobRunId;
  }
}
