export type UploadStatus =
  | 'idle'
  | 'checking-jobs'
  | 'hashing'
  | 'uploading'
  | 'finalizing'
  | 'complete'
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
  blockingJobs: BlockingJob[];
  showJobWarning: boolean;
  isUploading: boolean;
  handleFileSelect: (file: File | null) => void;
  handleUpgrade: () => Promise<void>;
  handleCancel: () => void;
  handleReset: () => void;
  closeJobWarning: () => void;
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
  checksum: string;
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
