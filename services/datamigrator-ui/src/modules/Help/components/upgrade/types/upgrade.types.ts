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

export type BlockingJobs = {
  runningJobs: Array<{ id: string; status: string; jobConfigId?: string; startTime?: string }>;
  scheduledJobs: Array<{ id: string; status: string; jobType?: string; futureScheduleAt?: string; scheduler?: string }>;
  activeJobConfigs: Array<{ id: string; jobType: string; status: string; scheduler?: string; futureScheduleAt?: string }>;
} | null;

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
  
  // Upgrade
  handleUpgrade: () => Promise<void>;
  isUpgrading: boolean;
  blockingJobs: BlockingJobs;
  
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

