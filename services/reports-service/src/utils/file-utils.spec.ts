import { sanitizeAndValidateFilePath } from "./file-utils";
import { BadRequestException } from "@nestjs/common";
import * as path from "path";

describe("sanitizeAndValidateFilePath", () => {
  const baseDir = "./error-logs";

  beforeEach(() => {
    // Remove any environment variable override for consistent tests
    delete process.env.ERROR_LOGS_DOWNLOAD_LOCATION;
  });

  it("should return the resolved path for a valid file name", () => {
    const fileName = "test-error-123.csv";
    const expected = path.resolve(baseDir, fileName);
    expect(sanitizeAndValidateFilePath(fileName, baseDir)).toBe(expected);
  });

  it("should allow .processing extension", () => {
    const fileName = "test-error-123.csv.processing";
    const expected = path.resolve(baseDir, fileName);
    expect(sanitizeAndValidateFilePath(fileName, baseDir)).toBe(expected);
  });

  it("should use process.env.ERROR_LOGS_DOWNLOAD_LOCATION if set", () => {
    process.env.ERROR_LOGS_DOWNLOAD_LOCATION = "/tmp/logs";
    const fileName = "abc-error-456.csv";
    const expected = path.resolve("/tmp/logs", fileName);
    expect(sanitizeAndValidateFilePath(fileName)).toBe(expected);
  });

  it("should throw BadRequestException for path traversal", () => {
    const fileName = "../evil-error-123.csv";
    expect(() => sanitizeAndValidateFilePath(fileName, baseDir)).toThrow(
      /Invalid file path/
    );
  });

  it("should throw BadRequestException for invalid file name", () => {
    const fileName = "test-error-abc.csv";
    expect(() => sanitizeAndValidateFilePath(fileName, baseDir)).toThrow(
      /Invalid file name/
    );
  });

  it("should throw BadRequestException and not call logger for invalid file name", () => {
    // logger is not used anymore, just check exception
    const fileName = "bad name.csv";
    expect(() => sanitizeAndValidateFilePath(fileName, baseDir)).toThrow(
      BadRequestException
    );
  });
});

describe("sanitizeIdentifier", () => {
  const { sanitizeIdentifier } = require("./file-utils");

  it("should return identifier if valid", () => {
    expect(sanitizeIdentifier("abc_123-xyz")).toBe("abc_123-xyz");
  });

  it("should throw BadRequestException for invalid identifier", () => {
    expect(() => sanitizeIdentifier("bad id!@#")).toThrow(BadRequestException);
    expect(() => sanitizeIdentifier("with space")).toThrow(BadRequestException);
  });
});
