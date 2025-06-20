import { filePathValidation } from './filepath-validation';
describe('filePathValidation', () => {
  it('should return true for a valid file path', () => {
    expect(filePathValidation('valid-file_path123.txt')).toBe(true);
  });

  it('should return false for a file path with invalid characters', () => {
    expect(filePathValidation('invalid/file\\path?.txt')).toBe(false);
  });

  it('should return true for a file path with only allowed characters', () => {
    expect(filePathValidation('another-valid_file-123.txt')).toBe(true);
  });

  it('should return false for a file path with special characters', () => {
    expect(filePathValidation('invalid@file#path$.txt')).toBe(false);
  });

  it('should return true for an empty file path', () => {
    expect(filePathValidation('')).toBe(true);
  });

  it('should return false for a file path with spaces', () => {
    expect(filePathValidation('file path with spaces.txt')).toBe(false);
  });
});
