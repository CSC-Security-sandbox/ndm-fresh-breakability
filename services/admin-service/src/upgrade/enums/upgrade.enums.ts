/**
 * Enum for upload status values
 * Used for tracking the state of file uploads
 * 
 * Flow: UPLOADING -> PROCESSING -> SUCCESS/FAILED
 * - UPLOADING: Chunks are being uploaded (can be cancelled)
 * - PROCESSING: Extraction, validation, organization in progress (DO NOT cancel)
 * - SUCCESS: Upload and processing completed successfully
 * - FAILED: Upload or processing failed
 * - CANCELLED: User cancelled the upload
 */
export enum UploadStatus {
  UPLOADING = 'uploading',
  PROCESSING = 'processing',  // New: extraction/validation in progress
  SUCCESS = 'success',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/**
 * Enum for upgrade status values
 * Used for tracking the state of upgrade operations
 * 
 * Flow: PENDING -> STAGED -> SUCCESS/FAILED/ROLLED_BACK
 * - PENDING: Upload successful, waiting for user to trigger upgrade
 * - STAGED: Upgrade triggered, ansible playbook launched on host
 * - SUCCESS: Upgrade completed successfully (set by ansible)
 * - FAILED: Upgrade failed (set by ansible or stale timeout)
 * - ROLLED_BACK: Upgrade failed and was rolled back (set by ansible)
 * - SKIPPED: User chose not to upgrade (clicked Reset after successful upload)
 */
export enum UpgradeStatus {
  PENDING = 'pending',
  STAGED = 'staged',
  SUCCESS = 'success',
  FAILED = 'failed',
  ROLLED_BACK = 'rolled_back',
  SKIPPED = 'skipped',
}

/**
 * Aggregate worker-level status on upgrade_bundles.
 * Tracks progress of multicast distribution and upgrade execution across all workers.
 */
export enum WorkerAggregateStatus {
  IDLE = 'IDLE',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
}
