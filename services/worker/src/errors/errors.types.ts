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
  public readonly code = 'E8DOT3_COLLISION';
  
  constructor(message: string, public readonly filePath?: string) {
    super(message);
    this.name = 'E8Dot3CollisionError';
  }
  
  static forFile(filePath: string, fileName?: string): E8Dot3CollisionError {
    const displayName = fileName || filePath.split(/[/\\]/).pop() || filePath;
    return new E8Dot3CollisionError(
      `8.3 short filename collision: '${displayName}' conflicts with existing short name pattern`,
      filePath
    );
  }
  
  static forDirectory(directoryPath: string): E8Dot3CollisionError {
    const dirName = directoryPath.split(/[/\\]/).pop() || directoryPath;
    return new E8Dot3CollisionError(
      `8.3 directory name collision: '${dirName}' conflicts with existing short name pattern`,
      directoryPath
    );
  }
}