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
  isUploadInProgress: boolean;       // true when a previous upload was interrupted (pod restart)
  inProgressFileName: string;
};

