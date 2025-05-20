import { FileServerDetails } from './file-server';
import { Serializable } from './serializable';

export class SpeedTestJobConfig implements Serializable {
  jobId: string;
  jobType: string;


  constructor(
    jobId: string,
    jobType: string,

  ) {
    this.jobId = jobId;
    this.jobType = jobType;
  }

  serialize(): string {
    return JSON.stringify(this);
  }

  deserialize(json: string): void {
    const obj = JSON.parse(json);
    this.jobId = obj.jobId;
    this.jobType = obj.jobType;
  }
}
