/**
 * Custom error classes for better error handling and categorization
 */

/**
 * Base application error class
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly timestamp: Date;

  constructor(message: string, code: string, statusCode: number = 500) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.timestamp = new Date();

    // Maintains proper stack trace for where our error was thrown
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Database-related errors
 */
export class DatabaseError extends AppError {
  constructor(message: string, originalError?: Error) {
    super(message, 'DATABASE_ERROR', 500);
    if (originalError) {
      this.stack = originalError.stack;
    }
  }
}

/**
 * Redis connection and operation errors
 */
export class RedisError extends AppError {
  constructor(message: string, originalError?: Error) {
    super(message, 'REDIS_ERROR', 503);
    if (originalError) {
      this.stack = originalError.stack;
    }
  }
}

/**
 * Temporal workflow errors
 */
export class WorkflowError extends AppError {
  constructor(message: string, originalError?: Error) {
    super(message, 'WORKFLOW_ERROR', 502);
    if (originalError) {
      this.stack = originalError.stack;
    }
  }
}

/**
 * Validation errors for invalid input data
 */
export class ValidationError extends AppError {
  constructor(message: string, field?: string) {
    super(field ? `${message} (field: ${field})` : message, 'VALIDATION_ERROR', 400);
  }
}

/**
 * Configuration errors
 */
export class ConfigurationError extends AppError {
  constructor(message: string) {
    super(message, 'CONFIGURATION_ERROR', 500);
  }
}

/**
 * Worker thread errors
 */
export class WorkerError extends AppError {
  constructor(message: string, exitCode?: number) {
    super(exitCode ? `${message} (exit code: ${exitCode})` : message, 'WORKER_ERROR', 500);
  }
}
