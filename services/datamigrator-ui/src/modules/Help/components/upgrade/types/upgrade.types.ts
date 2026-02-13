export type UploadStatus =
  | 'idle'
  | 'checking-jobs'
  | 'uploading'
  | 'finalizing'
  | 'uploaded'
  | 'error'
  | 'blocked'
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
  filePath?: string;
};

export type BlockingJob = {
  jobRunId: string;
  jobConfigId: string;
  status: string;
  jobType: string;
  volumePath?: string;
  sourceFileServerName?: string;
};

export type UpgradeStatus = 
  | 'idle'
  | 'checking-jobs'
  | 'blocked'
  | 'upgrading'
  | 'success'
  | 'error';

export type UpgradeProgress = {
  status: UpgradeStatus;
  error?: string;
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
  
  // Upgrade state
  upgradeProgress: UpgradeProgress;
  blockingJobs: BlockingJob[];
  showJobWarning: boolean;
  isUpgrading: boolean;
  handleUpgrade: () => Promise<void>;
  closeJobWarning: () => void;
  
  // Reset
  handleReset: () => void;
  
  // UI visibility flags (from DB state)
  showUploadUI: boolean;
  showUpgradeUI: boolean;
  isLoadingStatus: boolean;
  isUploadInProgress: boolean;
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

export type FinalizeUploadResponse = {
  success: boolean;
  path: string;
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
  uploadStatus?: string;
  upgradeSuccess?: boolean;
  fileName?: string;
  filePath?: string;
  fileSize?: number;
  version?: string;
  uploadCompletedAt?: string;
  upgradeCompletedAt?: string;
  showUploadUI: boolean;
  showUpgradeUI: boolean;
  isUploadInProgress: boolean;
};