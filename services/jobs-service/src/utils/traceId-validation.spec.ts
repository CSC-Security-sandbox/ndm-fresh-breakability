import { traceIdValidation } from './traceId-validation';

describe('traceIdValidation', () => {
  it('should return true for a valid UUID', () => {
    const validUUID = '123e4567-e89b-12d3-a456-426614174000';
    expect(traceIdValidation(validUUID)).toBe(true);
  });

  it('should return false for an invalid UUID with incorrect format', () => {
    const invalidUUID = '123e4567-e89b-12d3-a456-42661417400'; // Missing a digit
    expect(traceIdValidation(invalidUUID)).toBe(false);
  });

  it('should return false for an invalid UUID with invalid characters', () => {
    const invalidUUID = '123e4567-e89b-12d3-a456-42661417400z'; // Contains 'z'
    expect(traceIdValidation(invalidUUID)).toBe(false);
  });

  it('should return false for an empty string', () => {
    expect(traceIdValidation('')).toBe(false);
  });

  it('should return false for a null value', () => {
    expect(traceIdValidation(null as unknown as string)).toBe(false);
  });

  it('should return false for a string that is not a UUID', () => {
    const notUUID = 'this-is-not-a-uuid';
    expect(traceIdValidation(notUUID)).toBe(false);
  });
});