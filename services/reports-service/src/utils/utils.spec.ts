import { validateFilePath, escapeReportData, sanitizeReportData } from './utils';
describe('validateFilePath', () => {
  it('should return true for a valid file path', () => {
    expect(validateFilePath('valid-file_path123.txt')).toBe(true);
  });

  it('should return false for a file path with invalid characters', () => {
    expect(validateFilePath('invalidfile\\path?.txt')).toBe(false);
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

describe('validateFilePath', () => {
  it('should return true for a valid file path', () => {
    expect(validateFilePath('valid-file_path123.txt')).toBe(true);
  });

  it('should return false for a file path with invalid characters', () => {
    expect(validateFilePath('invalidfile\\path?.txt')).toBe(false);
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

describe('escapeReportData', () => {
  it('should escape HTML in a string', () => {
    expect(escapeReportData('<div>Test & "escape"</div>')).toBe('&lt;div&gt;Test &amp; &quot;escape&quot;&lt;/div&gt;');
  });

  it('should escape HTML in all string values of an object', () => {
    expect(escapeReportData({ a: '<b>bold</b>', b: 'plain' })).toEqual({ a: '&lt;b&gt;bold&lt;/b&gt;', b: 'plain' });
  });

  it('should escape HTML in all string values of an array', () => {
    expect(escapeReportData(['<i>italic</i>', 'safe'])).toEqual(['&lt;i&gt;italic&lt;/i&gt;', 'safe']);
  });
});

describe('sanitizeReportData', () => {
  it('should remove HTML tags from a string', () => {
    expect(sanitizeReportData('<div>Test <b>sanitize</b></div>')).toBe('Test sanitize');
  });

  it('should sanitize all string values of an object', () => {
    expect(sanitizeReportData({ a: '<b>bold</b>', b: 'plain' })).toEqual({ a: 'bold', b: 'plain' });
  });

  it('should sanitize all string values of an array', () => {
    expect(sanitizeReportData(['<i>italic</i>', 'safe'])).toEqual(['italic', 'safe']);
  });
});
