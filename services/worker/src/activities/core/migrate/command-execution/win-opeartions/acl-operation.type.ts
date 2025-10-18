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

interface AdsConfiguration {
  enabled: boolean;
  maxStreamSize: number; // Maximum size for in-memory processing (bytes)
  enableChecksum: boolean; // Whether to calculate checksums
  enableCompression: boolean; // Whether to compress large streams
  retryAttempts: number; // Number of retry attempts for failed operations
  chunkSize: number; // Chunk size for large stream processing
  supportedFileTypes: string[]; // File extensions to process ADS for
  excludeStreams: string[]; // Stream names to exclude from processing
}

interface AdsOperationResult {
  success: boolean;
  streamsProcessed: number;
  streamsFailed: number;
  totalSize: number;
  compressionRatio?: number;
  errors: string[];
  warnings: string[];
}

interface ValidatorOutput {
  sourceSID: string;
  targetSID: string;
  inValid: string;
}


