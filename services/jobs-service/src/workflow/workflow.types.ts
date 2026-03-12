export interface StartWorkFlowPayload {
  workflowId: string;
  taskQueue: string;
  args: unknown[];
  [key: string]: unknown;
}

export enum WorkflowExecutionStatus {
  COMPLETED = 'COMPLETED',
  RUNNING = 'RUNNING',
  TIMED_OUT = 'TIMED_OUT',
}

export interface SignalWorkFlowPayload {
  workflowId: string;
  signalName: string;
  payload: unknown;
}
