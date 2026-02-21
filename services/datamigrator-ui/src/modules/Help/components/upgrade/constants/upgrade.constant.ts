import { UploadProgress } from "../types/upgrade.types";

export const CHUNK_SIZE = 15 * 1024 * 1024; // 15MB
// Accept .tar.gz files - use MIME types + extensions for browser compatibility
export const ACCEPTED_FILE_TYPES = ".tar.gz,.gz,application/gzip,application/x-gzip,application/x-tar,application/x-compressed-tar";

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
  validation_failed: "Checksum validation failed",
  cancelled: "Upload cancelled",
};

// Initial States
export const INITIAL_UPLOAD_STATE: UploadProgress = {
  status: 'idle',
  progress: 0,
  currentChunk: 0,
  totalChunks: 0,
  uploadedBytes: 0,
  totalBytes: 0,
};
