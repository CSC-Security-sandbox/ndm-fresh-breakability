import { validateJobRunId } from './jobrunid-validation';

describe('validateJobRunId', () => {
  it('should return true for valid jobRunId with alphanumeric characters', () => {
    expect(validateJobRunId('abc123')).toBe(true);
  });

  it('should return true for valid jobRunId with hyphens', () => {
    expect(validateJobRunId('abc-123')).toBe(true);
  });

  it('should return false for jobRunId with special characters', () => {
    expect(validateJobRunId('abc@123')).toBe(false);
  });

  it('should return false for jobRunId with spaces', () => {
    expect(validateJobRunId('abc 123')).toBe(false);
  });

  it('should return false for an empty jobRunId', () => {
    expect(validateJobRunId('')).toBe(false);
  });

  it('should return false for jobRunId with underscores', () => {
    expect(validateJobRunId('abc_123')).toBe(false);
  });

  it('should return false for jobRunId with trailing spaces', () => {
    expect(validateJobRunId('abc123 ')).toBe(false);
  });

  it('should return false for jobRunId with leading spaces', () => {
    expect(validateJobRunId(' abc123')).toBe(false);
  });
});