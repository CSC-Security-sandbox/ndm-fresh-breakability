import { filePathValidation } from './filepath-validation';

describe('filePathValidation', () => {
  it('should remove invalid characters from the file path', () => {
    const input = 'invalid/path/with*chars?.txt';
    const expected = 'invalidpathwithchars.txt';
    expect(filePathValidation(input)).toBe(expected);
  });

  it('should allow valid characters in the file path', () => {
    const input = 'valid-path_123.txt';
    const expected = 'valid-path_123.txt';
    expect(filePathValidation(input)).toBe(expected);
  });

  it('should handle an empty string', () => {
    const input = '';
    const expected = '';
    expect(filePathValidation(input)).toBe(expected);
  });

  it('should handle a file path with only invalid characters', () => {
    const input = '*?<>|';
    const expected = '';
    expect(filePathValidation(input)).toBe(expected);
  });

  it('should handle a file path with mixed valid and invalid characters', () => {
    const input = 'valid*path?with<>invalid|chars.txt';
    const expected = 'validpathwithinvalidchars.txt';
    expect(filePathValidation(input)).toBe(expected);
  });

  it('should not modify a file path with only valid characters', () => {
    const input = 'valid-file_name-123.txt';
    const expected = 'valid-file_name-123.txt';
    expect(filePathValidation(input)).toBe(expected);
  });
});