/**
 * Binary Handler Interface & Base Class
 * 
 * IBinaryHandler: contract for platform-specific upgrade handlers.
 * BaseBinaryHandler: abstract class with the full download-extract-verify pipeline.
 * 
 * Only 2 methods differ per platform (abstract):
 *   - extractArchive()  — tar -xzf (linux) vs tar -xf (windows)
 *   - getBinary()      — no .exe (linux) vs .exe (windows)
 * 
 * Everything else (auth, download, checksum, cleanup) is shared.
 */

import * as fs from 'fs/promises';
import { createWriteStream } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { AuthService } from '../../auth/auth.service';
import { DownloadBundleOutput, ExecuteUpgradeOutput } from '../../workflows/upgrade/upgrade.types';

// =============================================================================
// Interface
// =============================================================================

export interface IBinaryHandler {
  /** Download bundle from CP, extract, verify, stage. */
  download(
    version: string,
    heartbeatFn: (stage: string) => void,
    bundleId?: string,
  ): Promise<DownloadBundleOutput>;

  /** Check if a version is already staged and valid. */
  isBinaryStaged(version: string): Promise<{ staged: boolean; platform: 'linux' | 'windows' }>;

  /** Spawn the upgrade script as a detached process. */
  executeUpgrade(version: string, bundleId?: string): Promise<ExecuteUpgradeOutput>;
}

// =============================================================================
// Base Handler (abstract)
// =============================================================================

export abstract class BaseBinaryHandler implements IBinaryHandler {
  /** Platform identifier */
  protected abstract readonly platform: 'linux' | 'windows';
  /** Archive extension: '.tar.gz' or '.zip' */
  protected abstract readonly archiveExtension: string;
  /** Base staging directory on worker */
  protected abstract readonly stagingBase: string;

  constructor(
    protected readonly httpService: HttpService,
    protected readonly authService: AuthService,
    protected readonly configService: ConfigService,
    protected readonly logger: LoggerService,
  ) {}

  // ===========================================================================
  // Abstract methods (only these differ per platform)
  // ===========================================================================

  /** Extract archive to destination directory. */
  protected abstract extractArchive(archivePath: string, destDir: string): Promise<void>;

  /** Find the binary file from a list of extracted filenames. */
  protected abstract getBinary(files: string[], version: string): string | undefined;

  protected abstract getChecksumFile(files:string[], version: string): string | undefined;

  protected abstract getEnvFile(files: string[], version: string): string | undefined;

  protected abstract getUpgradeScript(files: string[]): string | undefined;

  /** Spawn the upgrade script as a detached process. Platform-specific. */
  abstract executeUpgrade(version: string, bundleId?: string): Promise<ExecuteUpgradeOutput>;

  // ===========================================================================
  // Public: download
  // ===========================================================================

  async download(
    version: string,
    heartbeatFn: (stage: string) => void,
    bundleId?: string,
  ): Promise<DownloadBundleOutput> {
    this.validateVersion(version);
    const cpBaseUrl = this.getCpBaseUrl();
    const downloadUrl = `${cpBaseUrl}${this.getUpgradeEndpoint(version)}`;
    const headers = await this.getAuthHeaders();

    this.logger.log(`Downloading bundle for ${this.platform} v${version} from ${downloadUrl}`);

    const stagingDir = await this.ensureStagingDir(version);
    const archivePath = path.join(stagingDir, `bundle-${version}${this.archiveExtension}`);

    try {
      // 1. Stream download to file
      const archiveSize = await this.streamToFile(downloadUrl, archivePath, headers, heartbeatFn);

      // 2. Extract
      heartbeatFn('extracting archive');
      await this.extractArchive(archivePath, stagingDir);
      this.logger.log(`Extracted archive to ${stagingDir}`);

      // 3. Find files
      heartbeatFn('finding extracted files');
      const files = await fs.readdir(stagingDir);
      this.logger.log(`Extracted files: ${files.join(', ')}`);

      const binaryFile = this.getBinary(files, version);
      if (!binaryFile) {
        throw new Error(`Binary not found after extraction in ${stagingDir}. Files: ${files.join(', ')}`);
      }

      const checksumFile = this.getChecksumFile(files, version);
      if (!checksumFile) {
        throw new Error(`Checksums file not found after extraction in ${stagingDir}. Files: ${files.join(', ')}`);
      }

      const envFile = this.getEnvFile(files, version);
      if (!envFile) {
        throw new Error(`Env file not found after extraction in ${stagingDir}. Files: ${files.join(', ')}`);
      }

      const upgradeScript = this.getUpgradeScript(files);
      if (!upgradeScript) {
        throw new Error(`Upgrade script not found after extraction in ${stagingDir}. Files: ${files.join(', ')}`);
      }

      const binaryPath = path.join(stagingDir, binaryFile);
      const checksumPath = path.join(stagingDir, checksumFile);
      const downloadedEnvPath = path.join(stagingDir, envFile);
      const upgradeScriptPath = path.join(stagingDir, upgradeScript);

      // 4. Verify checksums (covers binary, env, AND upgrade script)
      heartbeatFn('verifying checksums');
      await this.verifyChecksums(stagingDir, checksumPath);
      this.logger.log('Checksums verified');
      await fs.unlink(checksumPath);

      // 5. Finalize env
      heartbeatFn('finalizing staged files');
      const envPath = await this.finalizeEnv(stagingDir, downloadedEnvPath);

      // 6. Write versions.conf into staging dir
      const stagedVersionsConf = path.join(stagingDir, 'versions.conf');
      await fs.writeFile(stagedVersionsConf, `current_version=${version}\n`);
      this.logger.log(`Wrote versions.conf to staging: current_version=${version}`);

      // 7. Write bundle ID to conf for post-upgrade ACK
      //    Isolated so a missing conf dir doesn't discard the staged bundle.
      if (bundleId) {
        try {
          const confDir = path.dirname(this.getStagingDir(version)).replace(/staging$/, 'conf');
          await fs.mkdir(confDir, { recursive: true });
          const bundleInfoPath = path.join(confDir, 'upgrade-bundle-id-info');
          await fs.writeFile(bundleInfoPath, `bundle_id=${bundleId}\n`);
          this.logger.log(`Wrote bundle_id=${bundleId} to ${bundleInfoPath}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`Failed to write bundle-id-info (upgrade will proceed without ACK bundleId): ${msg}`);
        }
      }

      // 8. Cleanup archive
      await this.safeDelete(archivePath);

      this.logger.log(`Bundle staged: ${stagingDir} (binary: ${binaryFile}, script: ${upgradeScript})`);

      return {
        stagedPath: stagingDir,
        sizeBytes: archiveSize,
        platform: this.platform,
        binaryPath,
        envPath,
        upgradeScriptPath,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to download/extract bundle: ${msg}`);

      // Clean up entire staging directory to avoid inconsistent state
      // on retry, isBinaryStaged could falsely report staged if partial files remain
      await this.cleanupStagingDir(stagingDir);

      throw error;
    }
  }

  // ===========================================================================
  // Public: isBinaryStaged
  // ===========================================================================

  async isBinaryStaged(version: string): Promise<{ staged: boolean; platform: 'linux' | 'windows' }> {
    this.validateVersion(version);
    const stagingDir = this.getStagingDir(version);
    const notStaged = { staged: false, platform: this.platform } as const;

    if (!(await this.pathExists(stagingDir))) {
      return notStaged;
    }

    const files = await fs.readdir(stagingDir);

    // Check binary exists and is valid
    const binaryFile = this.getBinary(files, version);
    if (!binaryFile) {
      return notStaged;
    }
    const binaryPath = path.join(stagingDir, binaryFile);
    if (!(await this.verifyBinary(binaryPath, version))) {
      return notStaged;
    }

    // Check versions.conf exists and matches the target version
    const versionsConfPath = path.join(stagingDir, 'versions.conf');
    if (!(await this.pathExists(versionsConfPath))) {
      this.logger.warn(`versions.conf missing in staging dir: ${stagingDir}`);
      return notStaged;
    }
    const confContent = await fs.readFile(versionsConfPath, 'utf-8');
    const versionMatch = confContent.match(/current_version=(.+)/);
    if (!versionMatch || versionMatch[1].trim() !== version) {
      this.logger.warn(`versions.conf version mismatch: expected ${version}, found ${versionMatch?.[1]?.trim()}`);
      return notStaged;
    }

    return { staged: true, platform: this.platform };
  }

  // ===========================================================================
  // Protected: auth + config helpers
  // ===========================================================================

  /**
   * Validate version string to prevent path traversal.
   * Only allows alphanumeric, dots, dashes, underscores.
   */
  protected validateVersion(version: string): void {
    if (!version || !/^[a-zA-Z0-9._-]+$/.test(version)) {
      throw new Error(`Invalid version string: ${version}. Only alphanumeric, dots, dashes, and underscores allowed.`);
    }
  }

  protected getCpBaseUrl(): string {
    const cpBaseUrl = process.env.CP_BASE_URL;
    if (cpBaseUrl) return cpBaseUrl;

    const cpIp = process.env.CONTROL_PLANE_IP;
    if (!cpIp) throw new Error('CONTROL_PLANE_IP environment variable is not set');
    return `https://${cpIp}`;
  }

  protected async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.authService.getAccessToken();
    if (!token) throw new Error('Failed to obtain authentication token from Keycloak');
    return { 'Authorization': `Bearer ${token}` };
  }

  protected getUpgradeEndpoint(version: string): string {
    return `/api/v1/upgrade/worker/download/${version}/${this.platform}`;
  }

  // ===========================================================================
  // Protected: staging directory
  // ===========================================================================

  protected getStagingDir(version: string): string {
    const resolved = path.resolve(this.stagingBase, version);
    if (!resolved.startsWith(path.resolve(this.stagingBase))) {
      throw new Error(`Invalid staging path for version: ${version}`);
    }
    return resolved;
  }

  protected async ensureStagingDir(version: string): Promise<string> {
    const dir = this.getStagingDir(version);
    try {
      await fs.mkdir(dir, { recursive: true });
      this.logger.log(`Ensured staging directory: ${dir}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to ensure staging directory ${dir}: ${msg}`);
      throw error;
    }
    return dir;
  }
  

  // ===========================================================================
  // Protected: stream download
  // ===========================================================================

  protected async streamToFile(
    url: string,
    destPath: string,
    headers: Record<string, string>,
    heartbeatFn: (stage: string) => void,
  ): Promise<number> {
    let response;
    try {
      response = await firstValueFrom(
        this.httpService.get(url, {
          responseType: 'stream',
          headers,
          timeout: 30 * 60 * 1000,
        }),
      );
    } catch (error: any) {
      const status = error?.response?.status || 'unknown';
      const statusText = error?.response?.statusText || '';
      throw new Error(`Download failed from ${url}: HTTP ${status} ${statusText}`);
    }

    const totalSize = parseInt(response.headers['content-length'] || '0', 10);
    let bytesReceived = 0;

    const heartbeatInterval = setInterval(() => {
      const pct = totalSize > 0 ? ((bytesReceived / totalSize) * 100).toFixed(1) : '?';
      heartbeatFn(`downloading: ${bytesReceived} / ${totalSize} bytes (${pct}%)`);
    }, 30_000);

    response.data.on('data', (chunk: Buffer) => {
      bytesReceived += chunk.length;
    });

    const writer = createWriteStream(destPath);
    response.data.pipe(writer);

    await new Promise<void>((resolve, reject) => {
      writer.on('finish', () => { clearInterval(heartbeatInterval); resolve(); });
      writer.on('error', (err) => { clearInterval(heartbeatInterval); reject(err); });
      response.data.on('error', (err: Error) => { clearInterval(heartbeatInterval); reject(err); });
    });

    if (!(await this.pathExists(destPath))) {
      throw new Error(`Download failed: file not written at ${destPath}`);
    }

    const stat = await fs.stat(destPath);
    if (stat.size === 0) {
      throw new Error(`Download failed: file at ${destPath} is empty (0 bytes)`);
    }

    this.logger.log(`Downloaded: ${destPath} (${stat.size} bytes)`);
    return stat.size;
  }



  // ===========================================================================
  // Protected: checksum verification
  // ===========================================================================

  protected async verifyChecksums(baseDir: string, checksumFilePath: string): Promise<void> {
    const content = (await fs.readFile(checksumFilePath, 'utf-8')).trim();
    const lines = content.split('\n').filter((line) => line.trim());

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;

      const expectedHash = parts[0].toLowerCase();
      const filename = parts[parts.length - 1].replace(/^\*/, '');
      const filePath = path.join(baseDir, filename);

      if (!(await this.pathExists(filePath))) {
        throw new Error(`File listed in checksums not found: ${filename} (expected at ${filePath})`);
      }

      const fileBuffer = await fs.readFile(filePath);
      const actualHash = crypto.createHash('sha256').update(fileBuffer).digest('hex').toLowerCase();

      if (actualHash === expectedHash) {
        this.logger.log(`Checksum OK: ${filename}`);
        continue;
      }

      // CRLF normalization fallback — only for known text files to avoid
      // corrupting binary checksums via Buffer→string→Buffer conversion
      const textExtensions = ['.env', '.txt', '.sh', '.ps1', '.conf', '.cfg', '.yaml', '.yml', '.json'];
      const isTextFile = textExtensions.some((ext) => filename.endsWith(ext));

      if (isTextFile) {
        const normalized = Buffer.from(fileBuffer.toString('utf-8').replace(/\r\n/g, '\n'));
        const normalizedHash = crypto.createHash('sha256').update(normalized).digest('hex').toLowerCase();

        if (normalizedHash === expectedHash) {
          this.logger.log(`Checksum OK (after CRLF normalization): ${filename}`);
          continue;
        }
      }

      throw new Error(`Checksum mismatch for ${filename}: expected ${expectedHash}, got ${actualHash}`);
    }
  }

  // ===========================================================================
  // Protected: binary verification
  // ===========================================================================

  protected async verifyBinary(binaryPath: string, version: string): Promise<boolean> {
    try {
      if (!(await this.pathExists(binaryPath))) return false;

      const dirName = path.basename(path.dirname(binaryPath));
      if (!dirName.includes(version)) return false;

      const filename = path.basename(binaryPath);
      if (!filename.includes(version)) return false;

      const stats = await fs.stat(binaryPath);
      if (stats.size < 1024 * 1024) return false;

      return true;
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // Protected: finalize env + cleanup
  // ===========================================================================

  protected async finalizeEnv(stagingDir: string, downloadedEnvPath: string): Promise<string> {
    if (await this.pathExists(downloadedEnvPath)) {
      await fs.rename(downloadedEnvPath, path.join(stagingDir, '.env'));
      this.logger.log(`Renamed ${downloadedEnvPath} → .env`);
    }
    return path.join(stagingDir, '.env');
  }

  protected async safeDelete(...paths: string[]): Promise<void> {
    for (const p of paths) {
      if (await this.pathExists(p)) await fs.unlink(p);
    }
  }

  /** Remove entire staging directory and all its contents. */
  protected async cleanupStagingDir(dirPath: string): Promise<void> {
    try {
      if (await this.pathExists(dirPath)) {
        await fs.rm(dirPath, { recursive: true, force: true });
        this.logger.log(`Cleaned up staging directory: ${dirPath}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to cleanup staging directory ${dirPath}: ${msg}`);
    }
  }

  // ===========================================================================
  // Private: helpers
  // ===========================================================================

  private async pathExists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }
}
