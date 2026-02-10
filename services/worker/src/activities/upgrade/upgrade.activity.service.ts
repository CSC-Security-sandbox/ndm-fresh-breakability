/**
 * Upgrade Activity Service
 * 
 * Activities for downloading and staging worker binaries.
 * These activities run ON the worker machine.
 * 
 * Activities:
 *   - downloadBinary: Download binary from CP to staging directory
 *   - stageBinary: Ensure binary is in staging directory and ready
 *   - ensureStagingDir: Create staging directory if not exists
 */

import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import * as fs from 'fs';
import * as path from 'path';
import { firstValueFrom } from 'rxjs';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { BinaryHandlerFactory } from './binary-handler.factory';
import { AuthService } from '../../auth/auth.service';
import {
  DownloadBinaryInput,
  DownloadBinaryOutput,
  DownloadEnvInput,
  DownloadEnvOutput,
  StageBinaryInput,
  StageBinaryOutput,
  WORKER_PATHS,
} from '../../workflows/upgrade/upgrade.types';

@Injectable()
export class UpgradeActivityService {
  private readonly logger: LoggerService;

  constructor(
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly authService: AuthService,
  ) {
    this.logger = loggerFactory.create(UpgradeActivityService.name);
  }

  /**
   * Get authentication token for CP API calls
   * Workers use client credentials flow
   */
  async getAuthToken(): Promise<string | null> {
    return this.authService.getAccessToken();
  }

  /**
   * Ensure staging directory exists
   * @param platform - 'linux' or 'windows'
   */
  async ensureStagingDir(platform: 'linux' | 'windows'): Promise<string> {
    const handler = BinaryHandlerFactory.create(platform);
    const stagingDir = handler.getStagingDir();

    if (!fs.existsSync(stagingDir)) {
      fs.mkdirSync(stagingDir, { recursive: true });
      this.logger.log(`Created staging directory: ${stagingDir}`);
    }

    return stagingDir;
  }

  /**
   * Download binary from CP to staging directory
   * @param input - Download parameters
   * @returns Path to downloaded binary and size
   */
  async downloadBinary(input: DownloadBinaryInput): Promise<DownloadBinaryOutput> {
    const { downloadUrl, platform, version, authToken } = input;

    this.logger.log(`Starting binary download from ${downloadUrl}`);

    // Get platform-specific handler
    const handler = BinaryHandlerFactory.create(platform);

    // Ensure staging directory exists
    await this.ensureStagingDir(platform);

    // Determine destination path
    const stagedPath = handler.getStagedBinaryPath(version);

    // Prepare headers
    const headers: Record<string, string> = {};
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    try {
      // Download using streams for large files
      const response = await firstValueFrom(
        this.httpService.get(downloadUrl, {
          responseType: 'stream',
          headers,
          timeout: 30 * 60 * 1000, // 30 minutes timeout
        }),
      );

      // Write to file
      const writer = fs.createWriteStream(stagedPath);
      response.data.pipe(writer);

      // Wait for download to complete
      await new Promise<void>((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      // Get file size
      const stats = fs.statSync(stagedPath);
      const sizeBytes = stats.size;

      // Make executable (Linux only)
      await handler.makeExecutable(stagedPath);

      this.logger.log(`Binary downloaded: ${stagedPath} (${sizeBytes} bytes)`);

      return {
        downloadedPath: stagedPath,
        sizeBytes,
      };
    } catch (error) {
      this.logger.error(`Failed to download binary: ${error.message}`);
      
      // Cleanup partial download
      if (fs.existsSync(stagedPath)) {
        fs.unlinkSync(stagedPath);
      }
      
      throw error;
    }
  }

  /**
   * Download env file from CP to staging directory
   * @param input - Download parameters
   * @returns Path to downloaded env file and size
   */
  async downloadEnv(input: DownloadEnvInput): Promise<DownloadEnvOutput> {
    const { downloadUrl, platform, authToken } = input;

    this.logger.log(`Starting env file download from ${downloadUrl}`);

    // Ensure staging directory exists
    await this.ensureStagingDir(platform);

    // Determine destination path for env file
    const stagingDir = BinaryHandlerFactory.create(platform).getStagingDir();
    const envFileName = WORKER_PATHS[platform].envFileName;
    const envPath = path.join(stagingDir, envFileName);

    // Prepare headers
    const headers: Record<string, string> = {};
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    try {
      // Download env file
      const response = await firstValueFrom(
        this.httpService.get(downloadUrl, {
          responseType: 'stream',
          headers,
          timeout: 5 * 60 * 1000, // 5 minutes timeout (env file is small)
        }),
      );

      // Write to file
      const writer = fs.createWriteStream(envPath);
      response.data.pipe(writer);

      // Wait for download to complete
      await new Promise<void>((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      // Get file size
      const stats = fs.statSync(envPath);
      const sizeBytes = stats.size;

      this.logger.log(`Env file downloaded: ${envPath} (${sizeBytes} bytes)`);

      return {
        downloadedPath: envPath,
        sizeBytes,
      };
    } catch (error) {
      this.logger.error(`Failed to download env file: ${error.message}`);
      
      // Cleanup partial download
      if (fs.existsSync(envPath)) {
        fs.unlinkSync(envPath);
      }
      
      throw error;
    }
  }

  /**
   * Verify binary is staged and ready
   * @param input - Stage parameters
   * @returns Staged path
   */
  async stageBinary(input: StageBinaryInput): Promise<StageBinaryOutput> {
    const { sourcePath, platform, version } = input;

    const handler = BinaryHandlerFactory.create(platform);
    const expectedPath = handler.getStagedBinaryPath(version);

    // If source is different from expected, move it
    if (sourcePath !== expectedPath) {
      if (fs.existsSync(sourcePath)) {
        // Ensure staging dir exists
        await this.ensureStagingDir(platform);
        
        // Copy to staging
        fs.copyFileSync(sourcePath, expectedPath);
        this.logger.log(`Binary copied from ${sourcePath} to ${expectedPath}`);
      }
    }

    // Verify binary
    const isValid = await handler.verifyBinary(expectedPath);
    if (!isValid) {
      throw new Error(`Binary verification failed: ${expectedPath}`);
    }

    // Make executable
    await handler.makeExecutable(expectedPath);

    this.logger.log(`Binary staged and verified: ${expectedPath}`);

    return {
      stagedPath: expectedPath,
    };
  }


  /**
   * Clean up staging directory
   * @param platform - 'linux' or 'windows'
   */
  async cleanupStagingDir(platform: 'linux' | 'windows'): Promise<void> {
    const handler = BinaryHandlerFactory.create(platform);
    const stagingDir = handler.getStagingDir();

    if (fs.existsSync(stagingDir)) {
      const files = fs.readdirSync(stagingDir);
      for (const file of files) {
        const filePath = path.join(stagingDir, file);
        fs.unlinkSync(filePath);
        this.logger.log(`Deleted: ${filePath}`);
      }
    }
  }

  /**
   * Check if binary is already staged
   * @param platform - 'linux' or 'windows'
   * @param version - Target version
   * @returns true if binary is staged and valid
   */
  async isBinaryStaged(platform: 'linux' | 'windows', version: string): Promise<boolean> {
    const handler = BinaryHandlerFactory.create(platform);
    const stagedPath = handler.getStagedBinaryPath(version);
    return handler.verifyBinary(stagedPath);
  }
}
