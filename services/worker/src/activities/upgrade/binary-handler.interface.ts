/**
 * Binary Handler Interface
 * 
 * Defines the contract for platform-specific binary handlers.
 * Used by the factory pattern to return Linux or Windows handler.
 * 
 * Note:
 *   - Binaries are already extracted on CP at /upgrade/worker/{platform}/
 *   - Worker downloads the binary file directly (not archive)
 *   - Binary names from CP: datamigrator-{version} (linux) or datamigrator-{version}.exe (windows)
 * 
 * Usage:
 *   const handler = BinaryHandlerFactory.create('linux');
 *   const endpoint = handler.getDownloadEndpoint();
 *   const stagedPath = handler.getStagedBinaryPath(version);
 */

// =============================================================================
// IBinaryHandler Interface
// =============================================================================

export interface IBinaryHandler {
  /**
   * Get the platform name
   * @returns 'linux' or 'windows'
   */
  getPlatform(): 'linux' | 'windows';

  /**
   * Get the API endpoint path for downloading binary
   * @returns e.g., '/api/v1/upgrade/worker/linux'
   */
  getDownloadEndpoint(): string;

  /**
   * Get the staging directory path on worker
   * @returns e.g., '/opt/datamigrator/staging' or 'C:\datamigrator\staging'
   */
  getStagingDir(): string;

  /**
   * Get the binary directory path (where current binary lives) on worker
   * @returns e.g., '/opt/datamigrator/binary' or 'C:\datamigrator\binary'
   */
  getBinaryDir(): string;

  /**
   * Get the binary filename for a version
   * @param version - Target version (e.g., '2026.02.08184701-nightly')
   * @returns e.g., 'datamigrator-2026.02.08184701-nightly' or 'datamigrator-2026.02.08184701-nightly.exe'
   */
  getBinaryFilename(version: string): string;

  /**
   * Get the staged binary path for a version (on worker)
   * @param version - Target version
   * @returns Full path to staged binary
   */
  getStagedBinaryPath(version: string): string;

  /**
   * Make the binary executable (Linux only, no-op on Windows)
   * @param binaryPath - Path to binary
   */
  makeExecutable(binaryPath: string): Promise<void>;

  /**
   * Verify the binary exists and is valid
   * @param binaryPath - Path to binary
   * @param version - Optional version string to verify in filename
   * @returns true if binary is valid
   */
  verifyBinary(binaryPath: string, version: string): Promise<boolean>;
}

// =============================================================================
// Binary Handler Config (shared config structure)
// =============================================================================

export interface BinaryHandlerConfig {
  /** Platform */
  platform: 'linux' | 'windows';
  /** API endpoint for download */
  endpoint: string;
  /** Staging directory on worker */
  stagingDir: string;
  /** Binary directory on worker */
  binaryDir: string;
  /** Binary name prefix */
  binaryNamePrefix: string;
  /** Binary extension (empty for linux, .exe for windows) */
  binaryExtension: string;
}

// =============================================================================
// Platform Configs
// =============================================================================

export const LINUX_CONFIG: BinaryHandlerConfig = {
  platform: 'linux',
  endpoint: '/api/v1/upgrade/worker/linux',
  stagingDir: '/opt/datamigrator/staging',
  binaryDir: '/opt/datamigrator/binary',
  binaryNamePrefix: 'datamigrator-',
  binaryExtension: '',
};

export const WINDOWS_CONFIG: BinaryHandlerConfig = {
  platform: 'windows',
  endpoint: '/api/v1/upgrade/worker/windows',
  stagingDir: 'C:\\datamigrator\\staging',
  binaryDir: 'C:\\datamigrator\\binary',
  binaryNamePrefix: 'datamigrator-',
  binaryExtension: '.exe',
};
