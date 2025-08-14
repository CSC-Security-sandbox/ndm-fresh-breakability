import {
  AppError,
  DatabaseError,
  RedisError,
  WorkflowError,
  ValidationError,
  ConfigurationError,
  WorkerError
} from './custom-errors';

describe('Custom Error Classes', () => {
  describe('AppError', () => {
    it('should create an AppError with correct properties', () => {
      const message = 'Test error message';
      const code = 'TEST_ERROR';
      const statusCode = 400;

      const error = new AppError(message, code, statusCode);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
      expect(error.name).toBe('AppError');
      expect(error.message).toBe(message);
      expect(error.code).toBe(code);
      expect(error.statusCode).toBe(statusCode);
      expect(error.timestamp).toBeInstanceOf(Date);
      expect(error.stack).toBeDefined();
    });

    it('should use default status code 500 when not provided', () => {
      const error = new AppError('Test message', 'TEST_CODE');

      expect(error.statusCode).toBe(500);
    });

    it('should maintain proper stack trace', () => {
      const error = new AppError('Test message', 'TEST_CODE');

      expect(error.stack).toContain('AppError: Test message');
      expect(error.stack).toContain('custom-errors.spec.ts');
    });
  });

  describe('DatabaseError', () => {
    it('should create a DatabaseError with correct properties', () => {
      const message = 'Database connection failed';
      const error = new DatabaseError(message);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(DatabaseError);
      expect(error.name).toBe('DatabaseError');
      expect(error.message).toBe(message);
      expect(error.code).toBe('DATABASE_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.timestamp).toBeInstanceOf(Date);
    });

    it('should preserve original error stack when provided', () => {
      const originalError = new Error('Original database error');
      const dbError = new DatabaseError('Database operation failed', originalError);

      expect(dbError.stack).toBe(originalError.stack);
    });

    it('should work without original error', () => {
      const dbError = new DatabaseError('Database operation failed');

      expect(dbError.stack).toContain('DatabaseError: Database operation failed');
    });
  });

  describe('RedisError', () => {
    it('should create a RedisError with correct properties', () => {
      const message = 'Redis connection lost';
      const error = new RedisError(message);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(RedisError);
      expect(error.name).toBe('RedisError');
      expect(error.message).toBe(message);
      expect(error.code).toBe('REDIS_ERROR');
      expect(error.statusCode).toBe(503);
      expect(error.timestamp).toBeInstanceOf(Date);
    });

    it('should preserve original error stack when provided', () => {
      const originalError = new Error('Redis timeout');
      const redisError = new RedisError('Redis operation failed', originalError);

      expect(redisError.stack).toBe(originalError.stack);
    });
  });

  describe('WorkflowError', () => {
    it('should create a WorkflowError with correct properties', () => {
      const message = 'Workflow execution failed';
      const error = new WorkflowError(message);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(WorkflowError);
      expect(error.name).toBe('WorkflowError');
      expect(error.message).toBe(message);
      expect(error.code).toBe('WORKFLOW_ERROR');
      expect(error.statusCode).toBe(502);
      expect(error.timestamp).toBeInstanceOf(Date);
    });

    it('should preserve original error stack when provided', () => {
      const originalError = new Error('Temporal client error');
      const workflowError = new WorkflowError('Workflow signal failed', originalError);

      expect(workflowError.stack).toBe(originalError.stack);
    });
  });

  describe('ValidationError', () => {
    it('should create a ValidationError with correct properties', () => {
      const message = 'Invalid input data';
      const error = new ValidationError(message);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.name).toBe('ValidationError');
      expect(error.message).toBe(message);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.statusCode).toBe(400);
      expect(error.timestamp).toBeInstanceOf(Date);
    });

    it('should include field name in message when provided', () => {
      const message = 'Invalid input data';
      const field = 'userId';
      const error = new ValidationError(message, field);

      expect(error.message).toBe(`${message} (field: ${field})`);
    });

    it('should work without field name', () => {
      const message = 'Invalid input data';
      const error = new ValidationError(message);

      expect(error.message).toBe(message);
    });
  });

  describe('ConfigurationError', () => {
    it('should create a ConfigurationError with correct properties', () => {
      const message = 'Configuration missing';
      const error = new ConfigurationError(message);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(ConfigurationError);
      expect(error.name).toBe('ConfigurationError');
      expect(error.message).toBe(message);
      expect(error.code).toBe('CONFIGURATION_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('WorkerError', () => {
    it('should create a WorkerError with correct properties', () => {
      const message = 'Worker thread failed';
      const error = new WorkerError(message);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(WorkerError);
      expect(error.name).toBe('WorkerError');
      expect(error.message).toBe(message);
      expect(error.code).toBe('WORKER_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.timestamp).toBeInstanceOf(Date);
    });

    it('should include exit code in message when provided', () => {
      const message = 'Worker thread failed';
      const exitCode = 1;
      const error = new WorkerError(message, exitCode);

      expect(error.message).toBe(`${message} (exit code: ${exitCode})`);
    });

    it('should work without exit code', () => {
      const message = 'Worker thread failed';
      const error = new WorkerError(message);

      expect(error.message).toBe(message);
    });
  });

  describe('Error Serialization', () => {
    it('should serialize custom errors properly with JSON.stringify', () => {
      const error = new DatabaseError('Test database error');
      const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));
      const parsed = JSON.parse(serialized);

      expect(parsed.name).toBe('DatabaseError');
      expect(parsed.message).toBe('Test database error');
      expect(parsed.code).toBe('DATABASE_ERROR');
      expect(parsed.statusCode).toBe(500);
      expect(parsed.timestamp).toBeDefined();
      expect(parsed.stack).toBeDefined();
    });

    it('should be distinguishable from generic Error', () => {
      const genericError = new Error('Generic error');
      const customError = new DatabaseError('Custom error');

      const genericSerialized = JSON.stringify(genericError, Object.getOwnPropertyNames(genericError));
      const customSerialized = JSON.stringify(customError, Object.getOwnPropertyNames(customError));

      const genericParsed = JSON.parse(genericSerialized);
      const customParsed = JSON.parse(customSerialized);

      expect(genericParsed.code).toBeUndefined();
      expect(genericParsed.statusCode).toBeUndefined();
      expect(genericParsed.timestamp).toBeUndefined();

      expect(customParsed.code).toBe('DATABASE_ERROR');
      expect(customParsed.statusCode).toBe(500);
      expect(customParsed.timestamp).toBeDefined();
    });
  });

  describe('Error Inheritance Chain', () => {
    it('should maintain proper inheritance chain for all custom errors', () => {
      const errors = [
        new DatabaseError('test'),
        new RedisError('test'),
        new WorkflowError('test'),
        new ValidationError('test'),
        new ConfigurationError('test'),
        new WorkerError('test')
      ];

      errors.forEach(error => {
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(AppError);
        expect(error.name).not.toBe('Error');
        expect(error.name).not.toBe('AppError');
        expect(error.code).toBeDefined();
        expect(error.statusCode).toBeDefined();
        expect(error.timestamp).toBeInstanceOf(Date);
      });
    });
  });

  describe('Error Stack Capture', () => {
    it('should capture stack trace correctly', () => {
      function createError() {
        return new DatabaseError('Test error from function');
      }

      const error = createError();

      expect(error.stack).toContain('DatabaseError: Test error from function');
      expect(error.stack).toContain('createError');
    });
  });
});
