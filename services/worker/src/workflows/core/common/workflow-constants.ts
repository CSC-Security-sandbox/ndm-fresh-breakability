/**
 * Shared constants for child scan and retry scan workflows.
 * 
 * These constants are used by Temporal workflows and cannot be retrieved from
 * ConfigService due to workflow determinism requirements. All workflow executions
 * must produce the same results given the same inputs.
 */

/**
 * Maximum number of batches to process in parallel.
 * Controls how many batch activities are executed concurrently.
 */
export const MAX_CONCURRENT_BATCHES = 20;

/**
 * Maximum number of iterations before triggering continueAsNew.
 * Prevents workflow history from growing too large.
 */
export const ITERATIONS_LIMIT = 1000;

/**
 * Number of iterations allocated for command length validation.
 * Used when calculating total iterations for continueAsNew threshold.
 */
export const CMD_LENGTH_VALIDATION_ITERATIONS = 10;

/**
 * Default batch size for processing operations/directories.
 * Used when batch size is not explicitly provided.
 */
export const DEFAULT_BATCH_SIZE = 100;
