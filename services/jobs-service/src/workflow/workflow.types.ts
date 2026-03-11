export interface StartWorkFlowPayload {
  workflowId: string;
  taskQueue: string;
  args: any[];
  [key: string]: any;
}

export enum WorkflowExecutionStatus {
  COMPLETED = 'COMPLETED',
  RUNNING = 'RUNNING',
  TIMED_OUT = 'TIMED_OUT',
}

export interface SignalWorkFlowPayload {
  workflowId: string;
  signalName: string;
  payload: any;
}
