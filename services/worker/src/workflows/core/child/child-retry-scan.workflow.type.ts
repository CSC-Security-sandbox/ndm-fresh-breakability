import { JobRunStatus } from "src/activities/common/enums";
import { FailedOperations } from "@netapp-cloud-datamigrate/jobs-lib";

/**
 * Cached scan settings extracted from JobContext.
 * These are serializable and can be passed between workflow and activities
 * to avoid re-extracting from Redis in each activity call.
 */
export interface RetryScanSettings {
  sourcePrefix: string;           // Base path prefix for source files
  targetPrefix: string;           // Base path prefix for target files
  skipFile: string;               // Skip files modified in last N time
  excludePatterns: string[];      // File patterns to exclude
  isSMB: boolean;                 // Whether this is an SMB migration
}

/**
 * Grouped operations batch stored in Redis.
 * Contains the parent directory path and all failed operations under it.
 */
export interface GroupedOperationsBatch {
  parentPath: string;              // Parent directory path (relative)
  operations: FailedOperations[];  // Failed operations in this directory
}

/**
 * Input for the ChildRetryScanWorkflow
 */
export interface ChildRetryScanWorkflowInput {
  jobRunId: string;           // New retry job run ID (for workflow IDs and Redis keys)
  originalJobRunId?: string;  // Original job run ID (to fetch failed operations from)
  actionState: JobRunStatus;
  opsBatchIds?: string[];     // Batch IDs for grouped operations (from fetchFailedOperations)
  batchDirs?: string[];       // Batch IDs for directory scans (subdirectories discovered)
  batchSize?: number;         // Number of directories per batch (from getWorkerScanConfig; default 100)
  /** Parallel retry batch activities; from getWorkerScanConfig (same as migration ChildScanWorkflow). */
  workerConcurrency?: number;
  settings?: RetryScanSettings; // Cached settings (populated on first fetch, passed on continueAsNew)
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
 * Input for the fetchFailedOperations activity
 */
export interface FetchFailedOperationsInput {
  jobRunId: string;           // New retry job run ID (for Redis context and cursor)
  originalJobRunId: string;   // Original job run ID (to fetch failed operations from API)
}

/**
 * Output from the fetchFailedOperations activity
 */
export interface FetchFailedOperationsOutput {
  opsBatchIds: string[];      // Batch IDs for grouped operations stored in Redis
  hasMore: boolean;           // Whether there are more pages to fetch
  settings: RetryScanSettings; // Cached settings extracted on first fetch
}

/**
 * Unified input for the processRetryBatch activity.
 * Handles both operations batch processing (type: 'ops') and directory scanning (type: 'dir').
 */
export interface ProcessRetryBatchInput {
  jobRunId: string;           // New retry job run ID (for Redis context)
  batchId: string;            // Batch ID (for ops: retryBatch, for dir: batchDir)
  type: 'ops' | 'dir';        // Processing mode: 'ops' for failed operations, 'dir' for full directory scan
  batchSize?: number;         // Number of directories per new batch (default 100)
  settings: RetryScanSettings; // Cached settings from workflow
}


export interface ProcessRetryBatchOutput {
  batchDirs: string[];        // Batch IDs for discovered subdirectories
}
