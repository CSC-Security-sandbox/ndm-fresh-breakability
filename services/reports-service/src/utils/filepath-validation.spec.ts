import { filePathValidation } from './filepath-validation';

describe('filePathValidation', () => {
  it('should remove invalid characters from the file path', () => {
    const input = 'invalid/path/with@#$%^&*()chars';
    const expected = 'invalid/path/withchars';
    expect(filePathValidation(input)).toBe(expected);
  });

  it('should allow valid characters in the file path', () => {
    const input = 'valid/path_with-characters123';
    const expected = 'valid/path_with-characters123';
    expect(filePathValidation(input)).toBe(expected);
  });

  it('should handle empty file paths', () => {
    const input = '';
    const expected = '';
    expect(filePathValidation(input)).toBe(expected);
  });

  it('should handle file paths with only invalid characters', () => {
    const input = '@#$%^&*()';
    const expected = '';
    expect(filePathValidation(input)).toBe(expected);
  });

  it('should not modify file paths with only valid characters', () => {
    const input = 'valid123/valid_path-123';
    const expected = 'valid123/valid_path-123';
    expect(filePathValidation(input)).toBe(expected);
  });

  it('should handle file paths with mixed valid and invalid characters', () => {
    const input = 'valid123/invalid@#$path';
    const expected = 'valid123/invalidpath';
    expect(filePathValidation(input)).toBe(expected);
  });
});