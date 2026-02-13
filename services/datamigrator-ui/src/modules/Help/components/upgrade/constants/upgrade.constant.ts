import { UploadProgress, UpgradeProgress } from "../types/upgrade.types";

export const CHUNK_SIZE = 100 * 1024 * 1024; // 100MB
export const ACCEPTED_FILE_TYPES = ".tar.gz,.zip";

// Job statuses that block upgrade
export const BLOCKING_JOB_STATUSES = ['RUNNING', 'SCHEDULED', 'PENDING', 'IN_PROGRESS'];

// UI Labels
export const SELECT_FILE_LABEL = "Select File";
export const UPLOAD_LABEL = "Upload";
export const UPGRADE_LABEL = "Upgrade";
export const CANCEL_LABEL = "Cancel";
export const RESET_LABEL = "Start Over";
export const CLEAR_FILE_LABEL = "Clear";

// Upload Status Messages
export const UPLOAD_STATUS_MESSAGES: Record<string, string> = {
  idle: "Select an upgrade bundle file",
  uploading: "Uploading",
  finalizing: "Processing: assembling, validating checksums, organizing files...",
  uploaded: "Upload complete - all checksums validated!",
  error: "Upload failed",
  cancelled: "Upload cancelled",
};

// Upgrade Status Messages
export const UPGRADE_STATUS_MESSAGES: Record<string, string> = {
  idle: "",
  "checking-jobs": "Checking for running jobs...",
  blocked: "Cannot upgrade - jobs are running",
  upgrading: "Starting upgrade...",
  success: "Upgrade initiated successfully!",
  error: "Upgrade failed",
};

// Warning Messages
export const JOB_WARNING_TITLE = "Cannot Upgrade";
export const JOB_WARNING_MESSAGE = "The following jobs are currently running or scheduled. Please wait for them to complete or cancel them before upgrading:";

// Initial States
export const INITIAL_UPLOAD_STATE: UploadProgress = {
  status: 'idle',
  progress: 0,
  currentChunk: 0,
  totalChunks: 0,
  uploadedBytes: 0,
  totalBytes: 0,
};

export const INITIAL_UPGRADE_STATE: UpgradeProgress = {
  status: 'idle',
};