/**
 * Upgrade Activity Service
 * 
 * Activities for downloading and staging worker upgrade bundles.
 * These activities run ON the worker machine.
 * 
 * Activities:
 *   - downloadBundle: Download bundle from CP, extract binary + env + verify checksums
 *   - isBinaryStaged: Check if version is already downloaded
 *   - ackUpgrade: Acknowledge download status to CP
 */

import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { firstValueFrom } from 'rxjs';
import { Context } from '@temporalio/activity';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { BinaryHandlerFactory } from './binary-handler.factory';
import { AuthService } from '../../auth/auth.service';
import {
  DownloadBundleInput,
  DownloadBundleOutput,
  UPGRADE_ENDPOINT,
  ARCHIVE_EXTENSION,
  WORKER_PATHS,
  workerStagingDir,
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

  // =============================================================================
  // Private helpers
  // =============================================================================

  /** Get Keycloak JWT token for CP API calls. */
  private async getAuthToken(): Promise<string> {
    const token = await this.authService.getAccessToken();
    if (!token) {
      throw new Error('Failed to obtain authentication token from Keycloak');
    }
    return token;
  }

  /** Get CP base URL from worker config. */
  private getCpBaseUrl(): string {
    const cpBaseUrl = process.env.CP_BASE_URL;
    if (cpBaseUrl) return cpBaseUrl;

    const cpIp = process.env.CONTROL_PLANE_IP;
    if (!cpIp) throw new Error('CONTROL_PLANE_IP environment variable is not set');
    return `https://${cpIp}`;
  }

  /** Build Authorization header with fresh JWT. */
  private async getAuthHeaders(): Promise<Record<string, string>> {
    const authToken = await this.getAuthToken();
    return { 'Authorization': `Bearer ${authToken}` };
  }

  /** Send a heartbeat to Temporal with a stage description. */
  private heartbeat(stage: string): void {
    try {
      Context.current().heartbeat({ stage });
      this.logger.log(`Heartbeat: ${stage}`);
    } catch { /* not in activity context during tests */ }
  }

  /** Detect platform: 'linux' or 'windows'. */
  private detectPlatform(): 'linux' | 'windows' {
    return process.platform === 'win32' ? 'windows' : 'linux';
  }

  /** Ensure versioned staging directory exists. Returns the path. */
  private ensureStagingDir(platform: 'linux' | 'windows', version: string): string {
    const stagingDir = workerStagingDir(platform, version);
    if (!fs.existsSync(stagingDir)) {
      fs.mkdirSync(stagingDir, { recursive: true });
      this.logger.log(`Created versioned staging directory: ${stagingDir}`);
    }
    return stagingDir;
  }

  // =============================================================================
  // Main activity: downloadBundle
  // =============================================================================

  /**
   * Download upgrade bundle from CP, extract, verify checksums.
   * 
   * The bundle is a single archive per platform:
   *   - Linux:   datamigrator-worker-{version}-linux.tar.gz
   *   - Windows: datamigrator-worker-{version}-windows.zip
   * 
   * Each archive contains:
   *   - Binary:    datamigrator-worker-{version}[.exe]
   *   - Env:       worker-{version}.env
   *   - Checksums: checksums.sha256
   * 
   * Steps:
   *   1. Download archive from CP (streamed with heartbeats)
   *   2. Extract to versioned staging directory
   *   3. Verify checksums for binary and env
   *   4. Rename env to .env
   *   5. Make binary executable (Linux only)
   *   6. Cleanup archive and checksum files
   */
  async downloadBundle(input: DownloadBundleInput): Promise<DownloadBundleOutput> {
    const { version } = input;
    const platform = this.detectPlatform();
    const ext = ARCHIVE_EXTENSION[platform];

    // Build versioned download URL and auth headers
    const cpBaseUrl = this.getCpBaseUrl();
    const downloadUrl = `${cpBaseUrl}${UPGRADE_ENDPOINT(version, platform)}`;
    const headers = await this.getAuthHeaders();

    this.logger.log(`Downloading bundle for ${platform} v${version} from ${downloadUrl}`);

    const handler = BinaryHandlerFactory.create(platform);
    const stagingDir = this.ensureStagingDir(platform, version);
    const archivePath = path.join(stagingDir, `bundle-${version}${ext}`);

    try {
      // 1. Download archive with heartbeat reporting
      const response = await firstValueFrom(
        this.httpService.get(downloadUrl, {
          responseType: 'stream',
          headers,
          timeout: 30 * 60 * 1000,
        }),
      );

      const totalSize = parseInt(response.headers['content-length'] || '0', 10);
      let bytesReceived = 0;

      const heartbeatInterval = setInterval(() => {
        try {
          const pct = totalSize > 0 ? ((bytesReceived / totalSize) * 100).toFixed(1) : '?';
          Context.current().heartbeat({ bytesReceived, totalSize, percent: pct });
          this.logger.log(`Download heartbeat: ${bytesReceived} / ${totalSize} bytes (${pct}%)`);
        } catch { /* not in activity context during tests */ }
      }, 30_000);

      response.data.on('data', (chunk: Buffer) => {
        bytesReceived += chunk.length;
      });

      const writer = fs.createWriteStream(archivePath);
      response.data.pipe(writer);

      await new Promise<void>((resolve, reject) => {
        writer.on('finish', () => { clearInterval(heartbeatInterval); resolve(); });
        writer.on('error', (err) => { clearInterval(heartbeatInterval); reject(err); });
      });

      const archiveSize = fs.statSync(archivePath).size;
      this.logger.log(`Downloaded archive: ${archivePath} (${archiveSize} bytes)`);

      // 2. Extract archive (platform-aware: tar.gz or zip)
      this.heartbeat('extracting archive');
      await this.extractArchive(archivePath, stagingDir, platform);
      this.logger.log(`Extracted archive to ${stagingDir}`);

      // Cleanup macOS resource fork files
      this.cleanupMacOSResourceForks(stagingDir);

      // 3. Find extracted files
      this.heartbeat('finding extracted files');
      const extractedFiles = fs.readdirSync(stagingDir);
      this.logger.log(`Extracted files: ${extractedFiles.join(', ')}`);

      // Find binary
      const binaryFile = extractedFiles.find((f) => {
        if (platform === 'linux') {
          return f.startsWith('datamigrator-') && !f.endsWith('.exe') && !f.endsWith('.sha256') && !f.endsWith('.tar.gz') && !f.endsWith('.zip') && !f.endsWith('.env');
        } else {
          return f.startsWith('datamigrator-') && f.endsWith('.exe');
        }
      });

      if (!binaryFile) {
        throw new Error(`Binary not found after extraction in ${stagingDir}. Files: ${extractedFiles.join(', ')}`);
      }

      // Find env file
      const envFile = extractedFiles.find((f) =>
        f.endsWith('.env') && f !== '.env',
      );

      // Find checksums file
      const checksumFile = extractedFiles.find((f) =>
        f.endsWith('.sha256') || f === 'checksums.sha256',
      );

      const binaryPath = path.join(stagingDir, binaryFile);

      // 4. Verify checksums — mandatory, fail if missing
      if (!checksumFile) {
        throw new Error(`Checksums file not found after extraction in ${stagingDir}. Files: ${extractedFiles.join(', ')}`);
      }

      this.heartbeat('verifying checksums');
      const checksumPath = path.join(stagingDir, checksumFile);
      await this.verifyChecksums(stagingDir, checksumPath);
      this.logger.log(`Checksums verified`);
      fs.unlinkSync(checksumPath);

      // 5. Rename env file to .env
      this.heartbeat('finalizing staged files');
      const envFileName = WORKER_PATHS[platform].envFileName;
      const finalEnvPath = path.join(stagingDir, envFileName);

      if (envFile) {
        const envFilePath = path.join(stagingDir, envFile);
        if (envFilePath !== finalEnvPath) {
          fs.renameSync(envFilePath, finalEnvPath);
          this.logger.log(`Renamed ${envFile} → ${envFileName}`);
        }
      }

      // 6. Make binary executable (Linux only)
      await handler.makeExecutable(binaryPath);

      // 7. Cleanup archive
      if (fs.existsSync(archivePath)) {
        fs.unlinkSync(archivePath);
      }

      this.logger.log(`Bundle staged: ${stagingDir} (binary: ${binaryFile}, env: ${envFileName})`);

      return {
        stagedPath: stagingDir,
        sizeBytes: archiveSize,
        platform,
        binaryPath,
        envPath: finalEnvPath,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to download/extract bundle: ${errorMessage}`);

      // Cleanup archive on failure
      if (fs.existsSync(archivePath)) {
        fs.unlinkSync(archivePath);
      }

      throw error;
    }
  }

  // =============================================================================
  // Other activities
  // =============================================================================

  /**
   * Check if bundle is already staged in the versioned staging directory.
   * Returns staged status and detected platform.
   */
  async isBinaryStaged(version: string): Promise<{ staged: boolean; platform: 'linux' | 'windows' }> {
    const platform = this.detectPlatform();
    const stagingDir = workerStagingDir(platform, version);

    if (!fs.existsSync(stagingDir)) {
      return { staged: false, platform };
    }

    const files = fs.readdirSync(stagingDir);
    const binaryFile = files.find((f) => {
      if (platform === 'linux') {
        return f.startsWith('datamigrator-') && !f.endsWith('.exe') && !f.endsWith('.sha256') && !f.endsWith('.tar.gz') && !f.endsWith('.zip') && !f.endsWith('.env');
      } else {
        return f.startsWith('datamigrator-') && f.endsWith('.exe');
      }
    });

    if (!binaryFile) {
      return { staged: false, platform };
    }

    const binaryPath = path.join(stagingDir, binaryFile);
    const handler = BinaryHandlerFactory.create(platform);
    const valid = await handler.verifyBinary(binaryPath, version);
    return { staged: valid, platform };
  }

  /**
   * Acknowledge download status to CP.
   * POST /api/v1/upgrade/worker/ack
   */
  async ackUpgrade(input: {
    version: string;
    status: 'success' | 'failed';
    message?: string;
  }): Promise<void> {
    const cpBaseUrl = this.getCpBaseUrl();
    const ackUrl = `${cpBaseUrl}/api/v1/upgrade/worker/ack`;
    const workerId = this.configService.get<string>('worker.workerId');

    this.logger.log(`Sending ack to ${ackUrl} for worker ${workerId}, status: ${input.status}`);

    const authToken = await this.authService.getAccessToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    try {
      await firstValueFrom(
        this.httpService.post(ackUrl, {
          workerId,
          version: input.version,
          status: input.status,
          message: input.message,
        }, { headers, timeout: 30000 }),
      );
      this.logger.log(`Ack sent successfully for worker ${workerId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to send ack: ${errorMessage}`);
    }
  }

  // =============================================================================
  // Helper methods
  // =============================================================================

  /**
   * Extract an archive to a destination directory.
   * Uses execFile (no shell) to prevent command injection.
   * Linux: tar -xzf (tar.gz)
   * Windows: tar -xf (zip) — Windows 10+ tar supports zip format
   */
  private async extractArchive(
    archivePath: string,
    destDir: string,
    platform: 'linux' | 'windows',
  ): Promise<void> {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);

    const args = platform === 'windows'
      ? ['-xf', archivePath, '-C', destDir]
      : ['-xzf', archivePath, '-C', destDir];

    await execFileAsync('tar', args);
  }

  /**
   * Remove macOS resource fork files (._*) from a directory.
   */
  private cleanupMacOSResourceForks(dirPath: string): void {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      if (file.startsWith('._')) {
        fs.unlinkSync(path.join(dirPath, file));
        this.logger.log(`Removed macOS resource fork file: ${file}`);
      }
    }
  }

  /**
   * Verify all checksums in a checksums.sha256 file.
   * The file contains lines like: <hash>  <filename>
   * Verifies each file listed in the checksums file.
   */
  private async verifyChecksums(baseDir: string, checksumFilePath: string): Promise<void> {
    const checksumContent = fs.readFileSync(checksumFilePath, 'utf-8').trim();
    const lines = checksumContent.split('\n').filter((line) => line.trim());

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;

      const expectedHash = parts[0].toLowerCase();
      // sha256sum outputs "hash  file" (text mode) or "hash *file" (binary mode)
      // Strip leading * if present
      const filename = parts[parts.length - 1].replace(/^\*/, '');

      const filePath = path.join(baseDir, filename);

      if (!fs.existsSync(filePath)) {
        throw new Error(`File listed in checksums not found: ${filename} (expected at ${filePath})`);
      }

      const fileBuffer = fs.readFileSync(filePath);
      const actualHash = crypto.createHash('sha256').update(fileBuffer).digest('hex').toLowerCase();

      if (actualHash === expectedHash) {
        this.logger.log(`Checksum OK: ${filename}`);
        continue;
      }

      // Try CRLF normalization for text files (Windows tar may convert LF → CRLF)
      const normalizedBuffer = Buffer.from(
        fileBuffer.toString('utf-8').replace(/\r\n/g, '\n'),
      );
      const normalizedHash = crypto.createHash('sha256').update(normalizedBuffer).digest('hex').toLowerCase();

      if (normalizedHash === expectedHash) {
        this.logger.log(`Checksum OK (after CRLF normalization): ${filename}`);
        continue;
      }

      throw new Error(
        `Checksum mismatch for ${filename}: expected ${expectedHash}, got ${actualHash}`,
      );
    }
  }
}
