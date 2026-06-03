/**
 * Shared constants for child scan and retry scan workflows.
 * 
 * These constants are used by Temporal workflows and cannot be retrieved from
 * ConfigService due to workflow determinism requirements. All workflow executions
 * must produce the same results given the same inputs.
 * 
 * WARNING: Workflow code runs inside a Temporal V8 sandbox where Node.js globals
 * like `process`, `require`, `__dirname` etc. are NOT available. Only use
 * plain literals and imports from @temporalio/* or other sandbox-safe modules.
 */

/**
 * Maximum number of iterations before triggering continueAsNew.
 * Prevents workflow history from growing too large.
 */
export const ITERATIONS_LIMIT = 1000;

/**
 * Default batch size for processing operations/directories.
 * Used when batch size is not explicitly provided.
 */
export const DEFAULT_BATCH_SIZE = 100;

/**
 * Number of paths to validate concurrently within a single batch.
 * Controls parallelism in ValidatePathWorkerWorkflow.
 */
export const VALIDATE_PATH_CONCURRENCY = 10;

/**
 * Maximum number of attempts for cancelling or signalling a child workflow
 * before surfacing the failure to the caller.
 */
export const SIGNAL_MAX_ATTEMPTS = 3;

/**
 * Delay between retry attempts when cancelling or signalling a child workflow.
 */
export const SIGNAL_RETRY_DELAY = '30s';

/**
 * Temporal startToCloseTimeout for the ACL setup activity (setupExportPathPermission).
 * Must exceed worst-case: 3 ACL commands × ACL_CMD_TIMEOUT_MS, times 3 retry attempts.
 * To change, update this constant and redeploy — env vars cannot be read in the workflow sandbox.
 */
export const ACL_ACTIVITY_TIMEOUT = '20m';
