import { validateFilePath } from './filepath-validation';
describe('validateFilePath', () => {
  it('should return true for a valid file path', () => {
    expect(validateFilePath('valid-file_path123.txt')).toBe(true);
  });

  it('should return false for a file path with invalid characters', () => {
    expect(validateFilePath('invalid/file\\path?.txt')).toBe(false);
  });

  it('should return true for a file path with only allowed characters', () => {
    expect(validateFilePath('another-valid_file-123.txt')).toBe(true);
  });

  it('should return false for a file path with special characters', () => {
    expect(validateFilePath('invalid@file#path$.txt')).toBe(false);
  });

  it('should return true for an empty file path', () => {
    expect(validateFilePath('')).toBe(true);
  });

  it('should return false for a file path with spaces', () => {
    expect(validateFilePath('file path with spaces.txt')).toBe(false);
  });
});
