import { SourceAclError, TargetAclError } from './acl-operation.error';

describe('ACL Operation Errors', () => {
  describe('SourceAclError', () => {
    it('should create SourceAclError with default code', () => {
      const message = 'Source ACL operation failed';
      const error = new SourceAclError(message);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(SourceAclError);
      expect(error.message).toBe(message);
      expect(error.name).toBe('SRC_ACL_ERROR');
      expect(error.code).toBe('SRC_ACL_ERROR');
      expect(error.stack).toBeDefined();
    });

    it('should create SourceAclError with custom code', () => {
      const message = 'Permission denied';
      const customCode = 'CUSTOM_SRC_ERROR';
      const error = new SourceAclError(message, customCode);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(SourceAclError);
      expect(error.message).toBe(message);
      expect(error.name).toBe('SRC_ACL_ERROR');
      expect(error.code).toBe(customCode);
      expect(error.stack).toBeDefined();
    });

    it('should create SourceAclError with empty message', () => {
      const message = '';
      const error = new SourceAclError(message);

      expect(error.message).toBe('');
      expect(error.name).toBe('SRC_ACL_ERROR');
      expect(error.code).toBe('SRC_ACL_ERROR');
    });

    it('should create SourceAclError with undefined code parameter', () => {
      const message = 'Test error';
      const error = new SourceAclError(message, undefined);

      expect(error.message).toBe(message);
      expect(error.name).toBe('SRC_ACL_ERROR');
      expect(error.code).toBe('SRC_ACL_ERROR'); // Default parameter value is used
    });

    it('should create SourceAclError with explicit custom code', () => {
      const message = 'Test error';
      const customCode = 'EXPLICIT_CODE';
      const error = new SourceAclError(message, customCode);

      expect(error.message).toBe(message);
      expect(error.name).toBe('SRC_ACL_ERROR');
      expect(error.code).toBe(customCode);
    });

    it('should maintain prototype chain correctly', () => {
      const error = new SourceAclError('Test');

      expect(error instanceof Error).toBe(true);
      expect(error instanceof SourceAclError).toBe(true);
      expect(Object.getPrototypeOf(error)).toBe(SourceAclError.prototype);
      expect(Object.getPrototypeOf(Object.getPrototypeOf(error))).toBe(
        Error.prototype,
      );
    });

    it('should be serializable to JSON', () => {
      const message = 'JSON serialization test';
      const code = 'JSON_TEST_CODE';
      const error = new SourceAclError(message, code);

      // Error objects need custom serialization
      const serialized = JSON.stringify({
        message: error.message,
        name: error.name,
        code: error.code,
        stack: error.stack,
      });
      const parsed = JSON.parse(serialized);

      expect(parsed.message).toBe(message);
      expect(parsed.name).toBe('SRC_ACL_ERROR');
      expect(parsed.code).toBe(code);
    });

    it('should handle special characters in message', () => {
      const message = 'Error with special chars: àáâãäåæç 中文 🚀 \n\t\r';
      const error = new SourceAclError(message);

      expect(error.message).toBe(message);
      expect(error.name).toBe('SRC_ACL_ERROR');
      expect(error.code).toBe('SRC_ACL_ERROR');
    });

    it('should be catchable in try-catch blocks', () => {
      const message = 'Catchable error';
      let caughtError: Error | null = null;

      try {
        throw new SourceAclError(message);
      } catch (error) {
        caughtError = error as Error;
      }

      expect(caughtError).toBeInstanceOf(SourceAclError);
      expect(caughtError?.message).toBe(message);
    });
  });

  describe('TargetAclError', () => {
    it('should create TargetAclError with default code', () => {
      const message = 'Target ACL operation failed';
      const error = new TargetAclError(message);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(TargetAclError);
      expect(error.message).toBe(message);
      expect(error.name).toBe('TARGET_ACL_ERROR');
      expect(error.code).toBe('TARGET_ACL_ERROR');
      expect(error.stack).toBeDefined();
    });

    it('should create TargetAclError with custom code', () => {
      const message = 'Access denied on target';
      const customCode = 'CUSTOM_TARGET_ERROR';
      const error = new TargetAclError(message, customCode);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(TargetAclError);
      expect(error.message).toBe(message);
      expect(error.name).toBe('TARGET_ACL_ERROR');
      expect(error.code).toBe(customCode);
      expect(error.stack).toBeDefined();
    });

    it('should create TargetAclError with empty message', () => {
      const message = '';
      const error = new TargetAclError(message);

      expect(error.message).toBe('');
      expect(error.name).toBe('TARGET_ACL_ERROR');
      expect(error.code).toBe('TARGET_ACL_ERROR');
    });

    it('should create TargetAclError with undefined code parameter', () => {
      const message = 'Test error';
      const error = new TargetAclError(message, undefined);

      expect(error.message).toBe(message);
      expect(error.name).toBe('TARGET_ACL_ERROR');
      expect(error.code).toBe('TARGET_ACL_ERROR'); // Default parameter value is used
    });

    it('should create TargetAclError with explicit custom code', () => {
      const message = 'Test error';
      const customCode = 'EXPLICIT_CODE';
      const error = new TargetAclError(message, customCode);

      expect(error.message).toBe(message);
      expect(error.name).toBe('TARGET_ACL_ERROR');
      expect(error.code).toBe(customCode);
    });

    it('should maintain prototype chain correctly', () => {
      const error = new TargetAclError('Test');

      expect(error instanceof Error).toBe(true);
      expect(error instanceof TargetAclError).toBe(true);
      expect(Object.getPrototypeOf(error)).toBe(TargetAclError.prototype);
      expect(Object.getPrototypeOf(Object.getPrototypeOf(error))).toBe(
        Error.prototype,
      );
    });

    it('should be serializable to JSON', () => {
      const message = 'JSON serialization test';
      const code = 'JSON_TEST_CODE';
      const error = new TargetAclError(message, code);

      // Error objects need custom serialization
      const serialized = JSON.stringify({
        message: error.message,
        name: error.name,
        code: error.code,
        stack: error.stack,
      });
      const parsed = JSON.parse(serialized);

      expect(parsed.message).toBe(message);
      expect(parsed.name).toBe('TARGET_ACL_ERROR');
      expect(parsed.code).toBe(code);
    });

    it('should handle special characters in message', () => {
      const message = 'Error with special chars: àáâãäåæç 中文 🚀 \n\t\r';
      const error = new TargetAclError(message);

      expect(error.message).toBe(message);
      expect(error.name).toBe('TARGET_ACL_ERROR');
      expect(error.code).toBe('TARGET_ACL_ERROR');
    });

    it('should be catchable in try-catch blocks', () => {
      const message = 'Catchable error';
      let caughtError: Error | null = null;

      try {
        throw new TargetAclError(message);
      } catch (error) {
        caughtError = error as Error;
      }

      expect(caughtError).toBeInstanceOf(TargetAclError);
      expect(caughtError?.message).toBe(message);
    });
  });

  describe('Error Class Comparison', () => {
    it('should differentiate between SourceAclError and TargetAclError', () => {
      const sourceError = new SourceAclError('Source error');
      const targetError = new TargetAclError('Target error');

      expect(sourceError).toBeInstanceOf(SourceAclError);
      expect(sourceError).not.toBeInstanceOf(TargetAclError);

      expect(targetError).toBeInstanceOf(TargetAclError);
      expect(targetError).not.toBeInstanceOf(SourceAclError);

      expect(sourceError.name).toBe('SRC_ACL_ERROR');
      expect(targetError.name).toBe('TARGET_ACL_ERROR');
    });

    it('should both be instances of Error', () => {
      const sourceError = new SourceAclError('Source error');
      const targetError = new TargetAclError('Target error');

      expect(sourceError).toBeInstanceOf(Error);
      expect(targetError).toBeInstanceOf(Error);
    });

    it('should have different default codes', () => {
      const sourceError = new SourceAclError('Error message');
      const targetError = new TargetAclError('Error message');

      expect(sourceError.code).toBe('SRC_ACL_ERROR');
      expect(targetError.code).toBe('TARGET_ACL_ERROR');
      expect(sourceError.code).not.toBe(targetError.code);
    });

    it('should support custom codes independently', () => {
      const sourceError = new SourceAclError('Source message', 'CUSTOM_SRC');
      const targetError = new TargetAclError('Target message', 'CUSTOM_TARGET');

      expect(sourceError.code).toBe('CUSTOM_SRC');
      expect(targetError.code).toBe('CUSTOM_TARGET');
      expect(sourceError.name).toBe('SRC_ACL_ERROR');
      expect(targetError.name).toBe('TARGET_ACL_ERROR');
    });
  });

  describe('Error Handling Patterns', () => {
    it('should support error chaining with cause', () => {
      const originalError = new Error('Original cause');
      const sourceError = new SourceAclError('Wrapped error');

      // Simulate error chaining by adding cause property
      (sourceError as any).cause = originalError;

      expect((sourceError as any).cause).toBe(originalError);
      expect(sourceError.message).toBe('Wrapped error');
    });

    it('should work with Promise rejection', async () => {
      const message = 'Async error test';

      await expect(Promise.reject(new SourceAclError(message))).rejects.toThrow(
        SourceAclError,
      );

      await expect(Promise.reject(new TargetAclError(message))).rejects.toThrow(
        TargetAclError,
      );
    });

    it('should preserve stack trace information', () => {
      const sourceError = new SourceAclError('Stack trace test');
      const targetError = new TargetAclError('Stack trace test');

      expect(sourceError.stack).toBeDefined();
      expect(targetError.stack).toBeDefined();
      expect(typeof sourceError.stack).toBe('string');
      expect(typeof targetError.stack).toBe('string');
      // Stack traces should contain some reference to the test file
      expect(
        sourceError.stack?.includes('.spec.ts') ||
          sourceError.stack?.includes('Error'),
      ).toBe(true);
      expect(
        targetError.stack?.includes('.spec.ts') ||
          targetError.stack?.includes('Error'),
      ).toBe(true);
    });

    it('should support error comparison for logging/handling', () => {
      const errors = [
        new SourceAclError('Source error 1'),
        new TargetAclError('Target error 1'),
        new SourceAclError('Source error 2', 'CUSTOM'),
        new Error('Generic error'),
      ];

      const sourceErrors = errors.filter(
        (err) => err instanceof SourceAclError,
      );
      const targetErrors = errors.filter(
        (err) => err instanceof TargetAclError,
      );
      const genericErrors = errors.filter(
        (err) =>
          !(err instanceof SourceAclError) && !(err instanceof TargetAclError),
      );

      expect(sourceErrors).toHaveLength(2);
      expect(targetErrors).toHaveLength(1);
      expect(genericErrors).toHaveLength(1);
    });
  });
});
