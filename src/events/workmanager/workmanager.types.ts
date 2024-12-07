import { JobType } from "src/constants/enums";

export interface TaskEventPayload {
  jobRunId: string;
  status: string;
  sPath: string;
  tPath: string | null;
  workers: string[]
  taskType: JobType;
}
  

export interface Task {
  id: string,
  jobRunId: string,
  taskType: string,
  status: string,
  workerId: string,
  sPath: string,
  commands: Record<string, any>[]
}