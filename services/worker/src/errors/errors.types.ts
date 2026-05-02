import { ErrorType } from '@netapp-cloud-datamigrate/jobs-lib';

export const METADATA_UPDATE_CONFLICT = 'METADATA_UPDATE_CONFLICT' as const;

export class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}

export class FatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FatalError';
  }
}

export class RetryExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryExceededError';
  }
}

export class E8Dot3CollisionError extends Error {
  code: string;
  filePath: string;
  errorType: ErrorType;

  constructor(filePath: string) {
    const message = `Cannot copy on destination due to 8.3 collision for path: ${filePath}`;
    super(message);
    this.name = 'E8Dot3CollisionError';
    this.code = 'E8DOT3_COLLISION';
    this.filePath = filePath;
    // E8DOT3_COLLISION is a TRANSIENT_ERROR - file-specific issue that doesn't cancel the entire activity
    this.errorType = ErrorType.TRANSIENT_ERROR;
  }
}

export class MetadataUpdateConflictError extends Error {
  code: string;
  filePath: string;
  errorType: ErrorType;

  constructor(filePath: string) {
    const message = 'Metadata update conflict: Unable to apply permission changes';
    super(message);
    this.name = 'MetadataUpdateConflictError';
    this.code = METADATA_UPDATE_CONFLICT;
    this.filePath = filePath;
    this.errorType = ErrorType.METADATA_UPDATE_CONFLICT;
  }
}
