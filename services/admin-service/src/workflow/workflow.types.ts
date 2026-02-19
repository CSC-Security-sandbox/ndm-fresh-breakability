export enum WorkFlows {
    BINARY_MULTICAST = 'BinaryMulticastWorkflow',
    UPGRADE_EXECUTION = 'UpgradeExecutionWorkflow',
  }

  export enum WorkflowExecutionStatus {
    RUNNING = 'RUNNING',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
    CANCELLED = 'CANCELLED',
    TERMINATED = 'TERMINATED',
    CONTINUED_AS_NEW = 'CONTINUED_AS_NEW',
    TIMED_OUT = 'TIMED_OUT',
  }
  
  export interface StartWorkFlowPayload {
    taskQueue: string;
    workflowId: string;
    args: any[];
  }