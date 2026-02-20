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
 * Flow: PENDING -> IN_PROGRESS -> SUCCESS/FAILED
 * - PENDING: Upload successful, waiting for user to trigger upgrade
 * - IN_PROGRESS: Upgrade is running
 * - SUCCESS: Upgrade completed successfully
 * - FAILED: Upgrade failed
 * - SKIPPED: User chose not to upgrade (clicked Reset after successful upload)
 */
export enum UpgradeStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  SUCCESS = 'success',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}
