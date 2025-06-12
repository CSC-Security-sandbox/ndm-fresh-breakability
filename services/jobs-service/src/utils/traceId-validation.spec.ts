import { traceIdValidation } from './traceId-validation';

describe('traceIdValidation', () => {
  it('should return true for a valid traceId', () => {
    const validTraceId = '12345678-1234-1234-1234-123456789012';
    expect(traceIdValidation(validTraceId)).toBe(true);
  });

  it('should return false for a traceId shorter than 36 characters', () => {
    const shortTraceId = '12345678-1234-1234-1234-12345678901';
    expect(traceIdValidation(shortTraceId)).toBe(false);
  });

  it('should return false for a traceId longer than 36 characters', () => {
    const longTraceId = '12345678-1234-1234-1234-1234567890123';
    expect(traceIdValidation(longTraceId)).toBe(false);
  });

  it('should return false for a traceId with special characters', () => {
    const invalidTraceId = '12345678-1234-1234-1234-1234567890@!';
    expect(traceIdValidation(invalidTraceId)).toBe(false);
  });

  it('should return false for an empty traceId', () => {
    const emptyTraceId = '';
    expect(traceIdValidation(emptyTraceId)).toBe(false);
  });

  it('should return false for a traceId with spaces', () => {
    const traceIdWithSpaces = '12345678-1234-1234-1234-123456789 12';
    expect(traceIdValidation(traceIdWithSpaces)).toBe(false);
  });
});