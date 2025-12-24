import { JobRunStatus } from "src/activities/common/enums";

/**
 * Input for the ChildRetryScanWorkflow
 */
export interface ChildRetryScanWorkflowInput {
  jobRunId: string;           // New retry job run ID (for workflow IDs and Redis keys)
  originalJobRunId?: string;  // Original job run ID (to fetch failed operations from)
  actionState: JobRunStatus;
}

/**
 * Output from the ChildRetryScanWorkflow
 */
export interface ChildRetryScanWorkflowOutput {
  jobRunId: string;
  status: JobRunStatus;
  error?: string;
}

/**
 * Input for the fetchRetryBatch activity
 */
export interface FetchRetryBatchInput {
  jobRunId: string;           // New retry job run ID (for Redis context)
  originalJobRunId: string;   // Original job run ID (to fetch failed operations from API)
}

/**
 * Output from the fetchRetryBatch activity
 */
export interface FetchRetryBatchOutput {
  hasMore: boolean;
}
