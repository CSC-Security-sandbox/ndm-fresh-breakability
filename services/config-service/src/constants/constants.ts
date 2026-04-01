// Temporal Workflow Timeout Constants
// Configurable via environment variables for large volume (50TB+) workloads.
// Execution timeouts span the entire workflow lifecycle including continueAsNew chains.
// Run timeouts apply to a single run (reset by continueAsNew).
export const WORKFLOW_TIMEOUTS = {
    PARENT_WORKFLOW_EXECUTION_TIMEOUT: process.env.PARENT_WORKFLOW_EXECUTION_TIMEOUT || '720h',
    PARENT_WORKFLOW_RUN_TIMEOUT: process.env.PARENT_WORKFLOW_RUN_TIMEOUT || '720h',
    CHILD_WORKFLOW_EXECUTION_TIMEOUT: process.env.CHILD_WORKFLOW_EXECUTION_TIMEOUT || '720h',
    CHILD_WORKFLOW_RUN_TIMEOUT: process.env.CHILD_WORKFLOW_RUN_TIMEOUT || '24h',
    ACTIVITY_TIMEOUT: process.env.ACTIVITY_TIMEOUT || '6h',
};

export const WORKFLOW_EXECUTION_TIMEOUT_SECONDS = 60;
