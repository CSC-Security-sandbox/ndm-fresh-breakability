import * as path from "path";
import { BadRequestException } from "@nestjs/common";

// Sanitizes and validates a file path to prevent path traversal and enforce a strict file name pattern.
export function sanitizeAndValidateFilePath(
  filePath: string,
  baseDir: string = process.env.ERROR_LOGS_DOWNLOAD_LOCATION || "./error-logs"
): string {
  try {
    const resolvedBase = path.resolve(baseDir);
    const resolvedPath = path.resolve(resolvedBase, filePath);
    if (!resolvedPath.startsWith(resolvedBase + path.sep)) {
      throw new BadRequestException('Invalid file path: Path traversal detected');
    }
    const fileName = path.basename(resolvedPath);
    if (!fileName) {
      throw new BadRequestException('File name cannot be empty');
    }
    if (!/^[\w\-]+-error-\d+\.csv(\.processing)?$/.test(fileName)) {
      throw new BadRequestException('Invalid file name');
    }
    return resolvedPath;
  } catch (error) {
    if (error instanceof BadRequestException) {
      throw error;
    }
    throw new BadRequestException(`File path validation failed: ${error.message}`);
  }
}

// Utility to strictly validate identifier for regex/file usage
export function sanitizeIdentifier(identifier: string): string {
  // Only allow alphanumeric, dash, and underscore
  try {
    if (!/^[\w-]+$/.test(identifier)) {
      throw new BadRequestException(
        'Invalid identifier: Only alphanumeric, dash, and underscore allowed'
      );
    }
    return identifier;
  } catch (error) {
    if (error instanceof BadRequestException) {
      throw error;
    }
    throw new BadRequestException(`Identifier validation failed: ${error.message}`);

  }
}
