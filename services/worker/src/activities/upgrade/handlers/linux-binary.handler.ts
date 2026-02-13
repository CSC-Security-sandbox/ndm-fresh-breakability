/**
 * Linux Binary Handler
 * 
 * Platform-specific handler for Linux binary operations.
 * Implements IBinaryHandler interface.
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { IBinaryHandler, LINUX_CONFIG } from '../binary-handler.interface';

const execAsync = promisify(exec);

export class LinuxBinaryHandler implements IBinaryHandler {
  private readonly config = LINUX_CONFIG;

  /**
   * Get the platform name
   */
  getPlatform(): 'linux' | 'windows' {
    return this.config.platform;
  }

  /**
   * Get the API endpoint path for downloading binary
   * @returns '/api/v1/upgrade/worker/linux'
   */
  getDownloadEndpoint(): string {
    return this.config.endpoint;
  }

  /**
   * Get the staging directory path on worker
   * @returns '/opt/datamigrator/staging'
   */
  getStagingDir(): string {
    return this.config.stagingDir;
  }

  /**
   * Get the binary directory path on worker
   * @returns '/opt/datamigrator/binary'
   */
  getBinaryDir(): string {
    return this.config.binaryDir;
  }

  /**
   * Get the binary filename for a version
   * @param version - e.g., '2026.02.08184701-nightly'
   * @returns e.g., 'datamigrator-2026.02.08184701-nightly'
   */
  getBinaryFilename(version: string): string {
    return `${this.config.binaryNamePrefix}${version}${this.config.binaryExtension}`;
  }

  /**
   * Get the staged binary path for a version
   * @param version - Target version
   * @returns e.g., '/opt/datamigrator/staging/datamigrator-2026.02.08184701-nightly'
   */
  getStagedBinaryPath(version: string): string {
    return path.join(this.getStagingDir(), this.getBinaryFilename(version));
  }

  /**
   * Make the binary executable (chmod +x)
   * @param binaryPath - Path to binary
   */
  async makeExecutable(binaryPath: string): Promise<void> {
    await execAsync(`chmod +x "${binaryPath}"`);
  }

  /**
   * Verify the binary exists and is valid
   * @param binaryPath - Path to binary
   * @param version - Optional version string to verify in filename
   * @returns true if binary exists and is executable
   */
  async verifyBinary(binaryPath: string, version: string): Promise<boolean> {
    try {
      // Check file exists
      if (!fs.existsSync(binaryPath)) {
        return false;
      }

      // Check parent directory name contains the version string
      const dirName = path.basename(path.dirname(binaryPath));
      if (!dirName.includes(version)) {
        return false;
      }

      // Check filename contains the version string
      const filename = path.basename(binaryPath);
      if (!filename.includes(version)) {
        return false;
      }

      // Check file size is reasonable (> 1MB)
      const stats = fs.statSync(binaryPath);
      if (stats.size < 1024 * 1024) {
        return false;
      }

      // Check it's executable
      fs.accessSync(binaryPath, fs.constants.X_OK);
      
      return true;
    } catch {
      return false;
    }
  }
}
