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

export type UpgradeContextType = {
    selectedFile: File | null;
    uploadProgress: UploadProgress;
    isUploading: boolean;
    isUploaded: boolean;
    handleFileSelect: (file: File | null) => void;
    handleUpload: () => Promise<void>;
    handleCancelUpload: () => Promise<void>;
    upgradeProgress: UpgradeProgress;
    blockingJobs: BlockingJob[];
    showJobWarning: boolean;
    isUpgrading: boolean;
    handleUpgrade: () => Promise<void>;
    closeJobWarning: () => void;
    handleReset: () => void;
  };
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
