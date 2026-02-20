export type UploadStatus =
  | 'idle'
  | 'uploading'
  | 'processing'   // extraction/validation in progress (chunks fully uploaded)
  | 'finalizing'
  | 'uploaded'
  | 'error'
  | 'validation_failed'
  | 'cancelled';

export type UploadProgress = {
  status: UploadStatus;
  progress: number;
  currentChunk: number;
  totalChunks: number;
  uploadedBytes: number;
  totalBytes: number;
  error?: string;
  fileName?: string;
  uploadId?: string;
  bundleId?: string;  // Use bundleId for triggerUpgrade (primary key - fast query)
};

export type UpgradeContextType = {
  // File selection
  selectedFile: File | null;
  handleFileSelect: (file: File | null) => void;
  
  // Upload state
  uploadProgress: UploadProgress;
  isUploading: boolean;
  isUploaded: boolean;
  handleUpload: () => Promise<void>;
  handleCancelUpload: () => Promise<void>;
  
  // Upgrade (DRAFT - ready to activate)
  handleUpgrade: () => Promise<void>;
  isUpgrading: boolean;
  
  // Reset
  handleReset: () => Promise<void>;
  
  // UI visibility flags (from DB state)
  showUploadUI: boolean;
  showUpgradeUI: boolean;  // true when upload complete, ready for upgrade
  isLoadingStatus: boolean;
  isProcessing: boolean;             // true when extracting/validating (should NOT be cancelled)
  inProgressFileName: string;
};

// API Response types
export type InitUploadResponse = {
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
};

export type UploadChunkResponse = {
  received: boolean;
  chunkIndex: number;
  bytesReceived: number;
};

export type ProcessUploadResponse = {
  success: boolean;
  path: string;
  bundleId: string;  // Bundle ID for triggerUpgrade
  fileSize: number;
  version?: string;
  message?: string;
  errors?: string[];  // Checksum validation or processing errors
};

export type UploadStatusResponse = {
  uploadId: string;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  receivedChunks: number;
  progress: number;
  missingChunks: number[];
};

export type LatestUploadStatusResponse = {
  hasUpload: boolean;
  bundleId?: string;                 // Use bundleId for triggerUpgrade (primary key - fast query)
  uploadStatus?: string;
  upgradeStatus?: string;
  fileName?: string;
  fileSize?: number;
  version?: string;
  uploadCompletedAt?: string;
  upgradeCompletedAt?: string;
  showUploadUI: boolean;
  showUpgradeUI: boolean;
  isProcessing?: boolean;            // true when extracting/validating
  isUpgradeInProgress?: boolean;
};

