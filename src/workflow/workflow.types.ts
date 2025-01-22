export interface StartWorkFlowPayload {
    workflowId: string;
    taskQueue: string;
    args: any[];
    [key: string]: any;
  }