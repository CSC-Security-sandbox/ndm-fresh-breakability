export interface TaskEventPayload {
  jobRunId: string;
  status: string;
  sPath: string;
  tPath: string | null;
  taskType: string;
}
  