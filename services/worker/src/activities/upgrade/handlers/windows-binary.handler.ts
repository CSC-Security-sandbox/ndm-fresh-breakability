/**
 * Windows Binary Handler
 * 
 * Platform-specific handler for Windows binary operations.
 * Implements IBinaryHandler interface.
 */

import * as fs from 'fs';
import * as path from 'path';
import { IBinaryHandler, WINDOWS_CONFIG } from '../binary-handler.interface';

export class WindowsBinaryHandler implements IBinaryHandler {
  private readonly config = WINDOWS_CONFIG;

  /**
   * Get the platform name
   */
  getPlatform(): 'linux' | 'windows' {
    return this.config.platform;
  }

  /**
   * Get the API endpoint path for downloading binary
   * @returns '/api/v1/upgrade/worker/windows'
   */
  getDownloadEndpoint(): string {
    return this.config.endpoint;
  }

  /**
   * Get the staging directory path on worker
   * @returns 'C:\datamigrator\staging'
   */
  getStagingDir(): string {
    return this.config.stagingDir;
  }

  /**
   * Get the binary directory path on worker
   * @returns 'C:\datamigrator\binary'
   */
  getBinaryDir(): string {
    return this.config.binaryDir;
  }

  /**
   * Get the binary filename for a version
   * @param version - e.g., '2026.02.08184701-nightly'
   * @returns e.g., 'datamigrator-2026.02.08184701-nightly.exe'
   */
  getBinaryFilename(version: string): string {
    return `${this.config.binaryNamePrefix}${version}${this.config.binaryExtension}`;
  }

  /**
   * Get the staged binary path for a version
   * @param version - Target version
   * @returns e.g., 'C:\datamigrator\staging\datamigrator-2026.02.08184701-nightly.exe'
   */
  getStagedBinaryPath(version: string): string {
    return path.join(this.getStagingDir(), this.getBinaryFilename(version));
  }

  /**
   * Make the binary executable (no-op on Windows, exe files are executable by default)
   * @param binaryPath - Path to binary
   */
  async makeExecutable(binaryPath: string): Promise<void> {
    // No-op on Windows - exe files are executable by default
  }

  /**
   * Verify the binary exists and is valid
   * @param binaryPath - Path to binary
   * @returns true if binary exists and has reasonable size
   */
  async verifyBinary(binaryPath: string, version: string): Promise<boolean> {
    try {
      // Check file exists
      if (!fs.existsSync(binaryPath)) {
        return false;
      }

      const filename = path.basename(binaryPath);

      // Check it has .exe extension
      if (!filename.toLowerCase().endsWith('.exe')) {
        return false;
      }

      // Check parent directory name contains the version string
      const dirName = path.basename(path.dirname(binaryPath));
      if (!dirName.includes(version)) {
        return false;
      }

      // Check filename contains the version string
      if (!filename.includes(version)) {
        return false;
      }

      // Check file size is reasonable (> 1MB)
      const stats = fs.statSync(binaryPath);
      if (stats.size < 1024 * 1024) {
        return false;
      }
      
      return true;
    } catch {
      return false;
    }
  }
}
