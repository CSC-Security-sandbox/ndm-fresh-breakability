/**
 * Shared constants for child scan and retry scan workflows.
 * 
 * These constants are used by Temporal workflows and cannot be retrieved from
 * ConfigService due to workflow determinism requirements. All workflow executions
 * must produce the same results given the same inputs.
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
