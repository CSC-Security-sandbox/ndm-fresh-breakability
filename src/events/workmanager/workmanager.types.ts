import { JobType } from "src/constants/enums";

export interface TaskEventPayload {
  jobRunId: string;
  status: string;
  sPath: string;
  tPath: string | null;
  workers: string[]
  taskType: JobType;
}
  

export interface TaskPayload {
  id: string,
  jobRunId: string,
  taskType: string,
  status: string,
  workerId: string,
  sPath: string,
  tPath: string,
  commands: Record<string, any>[]
}

export interface WorkerJobRuns {
  jobRunId: string,
  sPathId: string,
  tPathId: string 
}


export interface ScanCompletedCommands{
  fPath: string,
  ops: {
    0 : {
      cmd: string
      status: string
      error: any
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
  tPath: string | null,
  commands: ScanCompletedCommands[]
}