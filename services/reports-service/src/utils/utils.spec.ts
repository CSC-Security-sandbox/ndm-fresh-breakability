import { validateFilePath, escapeCsvValue } from "./utils";
describe("validateFilePath", () => {
  it("should return true for a valid file path", () => {
    expect(validateFilePath("valid-file_path123.txt")).toBe(true);
  });

  it("should return false for a file path with invalid characters", () => {
    expect(validateFilePath("invalid/file\\path?.txt")).toBe(false);
  });

  it("should return true for a file path with only allowed characters", () => {
    expect(validateFilePath("another-valid_file-123.txt")).toBe(true);
  });

  it("should return false for a file path with special characters", () => {
    expect(validateFilePath("invalid@file#path$.txt")).toBe(false);
  });

  it("should return true for an empty file path", () => {
    expect(validateFilePath("")).toBe(true);
  });

  it("should return false for a file path with spaces", () => {
    expect(validateFilePath("file path with spaces.txt")).toBe(false);
  });
});
describe("escapeCsvValue", () => {
  it("should wrap value with comma in double quotes", () => {
    expect(escapeCsvValue("hello,world")).toBe('"hello,world"');
  });

  it('should return false for a file path with invalid characters', () => {
    expect(validateFilePath('invalidfile\\path?.txt')).toBe(false);
  it("should wrap value with newline in double quotes", () => {
    expect(escapeCsvValue("line1\nline2")).toBe('"line1\nline2"');
  });

  it("should escape double quotes and wrap in double quotes", () => {
    expect(escapeCsvValue('He said "Hi"')).toBe('"He said ""Hi"""');
  });

  it("should wrap value with comma and quote in double quotes and escape quotes", () => {
    expect(escapeCsvValue('a,"b"')).toBe('"a,""b"""');
  });

  it("should return value as is if no special characters", () => {
    expect(escapeCsvValue("plainvalue")).toBe("plainvalue");
  });

  it("should handle empty string", () => {
    expect(escapeCsvValue("")).toBe("");
  });
});
