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
      throw new Error("Invalid file path: Path traversal detected");
    }
    const fileName = path.basename(resolvedPath);
    if (!/^[\w\-]+-error-\d+\.csv(\.processing)?$/.test(fileName)) {
      throw new Error("Invalid file name");
    }
    return resolvedPath;
  } catch (error) {
    throw new BadRequestException(error.message);
  }
}

// Utility to strictly validate identifier for regex/file usage
export function sanitizeIdentifier(identifier: string): string {
  // Only allow alphanumeric, dash, and underscore
  try {
    if (!/^[\w-]+$/.test(identifier)) {
      throw new Error(
        "Invalid identifier: Only alphanumeric, dash, and underscore allowed"
      );
    }
    return identifier;
  } catch (error) {
    throw new BadRequestException(error.message);
  }
}
