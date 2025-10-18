type SecurityDescriptor = {
  Owner: string;
  Group: string;
  DaclAces: Ace[];
  AdsStreams?: AdsStream[];
  Attributes: string;
  DaclPresent: boolean;
  DaclProtected: boolean;
  DaclAutoInherit: boolean;
  originalOwner: string;
  originalGroup: string;
};

type Ace = {
  Sid: string;
  AccessMask: number;
  AceType: number;
  AceFlags: number;
  IsInherited: boolean;
  originalSid: string;
};

type AdsStream = {
  StreamName: string;
  Size: number;
  Content: string;
  IsBinary: boolean;
  Encoding?: string; // 'utf8' | 'base64' | 'ascii' | 'chunked'
  Checksum?: string; // MD5 hash for integrity verification
  IsLarge?: boolean; // Indicates if stream requires chunked processing
};

// Lightweight stream metadata for task creation (no content)
interface AdsStreamMetadata {
  streamName: string;
  size: number;
  estimatedType: 'text' | 'binary' | 'unknown';
  priority: 'critical' | 'normal' | 'low';
  estimatedTransferTime: number; // milliseconds
}

// Discovery result for temporal task creation
interface AdsDiscoveryResult {
  fileId: string;
  filePath: string;
  streamCount: number;
  totalAdsSize: number;
  streams: AdsStreamMetadata[];
  estimatedTotalTime: number;
  requiresSpecialHandling: boolean;
}

// Task definitions for temporal queue
interface AdsDiscoveryTask {
  taskType: 'ADS_DISCOVERY';
  fileId: string;
  filePath: string;
  priority: number;
  metadata: {
    fileSize: number;
    lastModified: Date;
    fileType: string;
  };
}

interface AdsTransferTask {
  taskType: 'ADS_TRANSFER';
  id: string;
  parentFileId: string;
  streamName: string;
  streamSize: number;
  sourcePath: string; // file.txt:streamname
  targetPath: string; // target/file.txt:streamname
  priority: number;
  estimatedDuration: number;
  dependencies: string[]; // Parent file transfer task IDs
  retryAttempts: number;
  metadata: {
    estimatedType: 'text' | 'binary' | 'unknown';
    compressionEnabled: boolean;
    checksumRequired: boolean;
    useStreamingTransfer: boolean;
  };
}

interface AdsValidationTask {
  taskType: 'ADS_VALIDATION';
  parentFileId: string;
  targetFilePath: string;
  expectedStreams: AdsStreamMetadata[];
  dependencies: string[]; // All ADS transfer task IDs
  validationLevel: 'basic' | 'full' | 'checksum';
}



interface AdsOperationResult {
  success: boolean;
  streamsProcessed: number;
  streamsFailed: number;
  totalSize: number;
  compressionRatio?: number;
  errors: string[];
  warnings: string[];
  processingMode: 'low-level' | 'temporal' | 'hybrid'; // Updated to include hybrid
  taskIds?: string[]; // Temporal task IDs if applicable
}

interface ValidatorOutput {
  sourceSID: string;
  targetSID: string;
  inValid: string;
}


