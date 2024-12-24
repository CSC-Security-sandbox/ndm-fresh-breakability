import { JobType } from "src/constants/enums";
import { JobRunConfig } from "src/jobrun/jobrun.types";

export interface MountedStatus{
  jobRunId: string,
  workerId: string
  status: boolean
}


export interface TaskEventPayload {
  jobRunId: string;
  status: string;
  details: JobRunConfig
}
  

export interface TaskPayload {
  id: string,
  jobRunId: string,
  taskType: string,
  status: string,
  workerId: string,
  sPath: string,
  tPath: string,
  sourceWorkingDir: string | null;
  targetWorkingDir: string | null;
  excludeFilePatterns: string | null;
  targetDirectory?:string,
  commands: Record<string, any>[]
}

export interface WorkerJobRuns {
  jobRunId: string,
  sPathId: string,
  tPathId: string 
  status: string,
  options?: {
    excludeOlderThan: Date,
    excludeFilePatterns: string | null,
    preserveAccessTime: boolean,
    sourceWorkingDir: string | null,
    targetWorkingDir: string | null;
  }
}


export interface ScanCompletedCommands{
  fPath: string,
  ops: {
    0 : {
      cmd?: string
      status: string
      error?: any
    }
  }
}

export interface ScanCompletedPayload{
  id: string,
  jobRunId: string,
  taskType: string,
  status: string,
  workerId: string,
  sPath: string,
  tPath?: string | null,
  commands: ScanCompletedCommands[]
}