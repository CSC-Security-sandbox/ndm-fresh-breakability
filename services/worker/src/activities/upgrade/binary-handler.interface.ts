/**
 * Binary Handler Interface & Base Class
 * 
 * IBinaryHandler: contract for platform-specific upgrade handlers.
 * BaseBinaryHandler: abstract class with the full download-extract-verify pipeline.
 * 
 * Only 3 methods differ per platform (abstract):
 *   - extractArchive()  — tar -xzf (linux) vs tar -xf (windows)
 *   - getBinary()      — no .exe (linux) vs .exe (windows)
 *   - makeExecutable()  — chmod +x (linux) vs no-op (windows)
 * 
 * Everything else (auth, download, checksum, cleanup) is shared.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { AuthService } from '../../auth/auth.service';
import { DownloadBundleOutput } from '../../workflows/upgrade/upgrade.types';

// =============================================================================
// Interface
// =============================================================================

export interface IBinaryHandler {
  /** Download bundle from CP, extract, verify, stage. */
  download(
    version: string,
    heartbeatFn: (stage: string) => void,
  ): Promise<DownloadBundleOutput>;

  /** Check if a version is already staged and valid. */
  isBinaryStaged(version: string): Promise<{ staged: boolean; platform: 'linux' | 'windows' }>;
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

  /** Make the binary executable (chmod +x on linux, no-op on windows). */
  protected abstract makeExecutable(binaryPath: string): Promise<void>;

  protected abstract getChecksumFile(files:string[], version: string): string | undefined;

  protected abstract getEnvFile(files: string[], version: string): string | undefined;

  // ===========================================================================
  // Public: download
  // ===========================================================================

  async download(
    version: string,
    heartbeatFn: (stage: string) => void,
  ): Promise<DownloadBundleOutput> {
    this.validateVersion(version);
    const cpBaseUrl = this.getCpBaseUrl();
    const downloadUrl = `${cpBaseUrl}${this.getUpgradeEndpoint(version)}`;
    const headers = await this.getAuthHeaders();

    this.logger.log(`Downloading bundle for ${this.platform} v${version} from ${downloadUrl}`);

    const stagingDir = this.ensureStagingDir(version);
    const archivePath = path.join(stagingDir, `bundle-${version}${this.archiveExtension}`);

    try {
      // 1. Stream download to file
      const archiveSize = await this.streamToFile(downloadUrl, archivePath, headers, heartbeatFn);

      // 2. Extract
      heartbeatFn('extracting archive');
      await this.extractArchive(archivePath, stagingDir);
      this.logger.log(`Extracted archive to ${stagingDir}`);

      // 3. Cleanup macOS junk files (.DS_Store, ._ resource forks)
      this.cleanupMacOSJunk(stagingDir);

      // 4. Find files
      heartbeatFn('finding extracted files');
      const files = fs.readdirSync(stagingDir);
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

      const binaryPath = path.join(stagingDir, binaryFile);
      const checksumPath = path.join(stagingDir, checksumFile);
      const downloadedEnvPath = path.join(stagingDir, envFile);

      // 5. Verify checksums
      heartbeatFn('verifying checksums');
      this.verifyChecksums(stagingDir, checksumPath);
      this.logger.log('Checksums verified');
      fs.unlinkSync(checksumPath);

      // 6. Finalize env
      heartbeatFn('finalizing staged files');
      const envPath = this.finalizeEnv(stagingDir, downloadedEnvPath);

      // 7. Make binary executable
      await this.makeExecutable(binaryPath);

      // 8. Cleanup archive
      this.safeDelete(archivePath);

      this.logger.log(`Bundle staged: ${stagingDir} (binary: ${binaryFile})`);

      return {
        stagedPath: stagingDir,
        sizeBytes: archiveSize,
        platform: this.platform,
        binaryPath,
        envPath,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to download/extract bundle: ${msg}`);

      // Clean up entire staging directory to avoid inconsistent state
      // on retry, isBinaryStaged could falsely report staged if partial files remain
      this.cleanupStagingDir(stagingDir);

      throw error;
    }
  }

  // ===========================================================================
  // Public: isBinaryStaged
  // ===========================================================================

  async isBinaryStaged(version: string): Promise<{ staged: boolean; platform: 'linux' | 'windows' }> {
    this.validateVersion(version);
    const stagingDir = this.getStagingDir(version);

    if (!fs.existsSync(stagingDir)) {
      return { staged: false, platform: this.platform };
    }

    const files = fs.readdirSync(stagingDir);
    const binaryFile = this.getBinary(files, version);

    if (!binaryFile) {
      return { staged: false, platform: this.platform };
    }

    const binaryPath = path.join(stagingDir, binaryFile);
    const valid = this.verifyBinary(binaryPath, version);
    return { staged: valid, platform: this.platform };
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
    return `/api/v1/upgrade/worker/${version}/${this.platform}`;
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

  protected ensureStagingDir(version: string): string {
    const dir = this.getStagingDir(version);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        this.logger.log(`Created staging directory: ${dir}`);
      }
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

    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);

    await new Promise<void>((resolve, reject) => {
      writer.on('finish', () => { clearInterval(heartbeatInterval); resolve(); });
      writer.on('error', (err) => { clearInterval(heartbeatInterval); reject(err); });
      response.data.on('error', (err: Error) => { clearInterval(heartbeatInterval); reject(err); });
    });

    if (!fs.existsSync(destPath)) {
      throw new Error(`Download failed: file not written at ${destPath}`);
    }

    const size = fs.statSync(destPath).size;
    if (size === 0) {
      throw new Error(`Download failed: file at ${destPath} is empty (0 bytes)`);
    }

    this.logger.log(`Downloaded: ${destPath} (${size} bytes)`);
    return size;
  }



  // ===========================================================================
  // Protected: checksum verification
  // ===========================================================================

  protected verifyChecksums(baseDir: string, checksumFilePath: string): void {
    const content = fs.readFileSync(checksumFilePath, 'utf-8').trim();
    const lines = content.split('\n').filter((line) => line.trim());

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;

      const expectedHash = parts[0].toLowerCase();
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

      // CRLF normalization fallback — only for known text files to avoid
      // corrupting binary checksums via Buffer→string→Buffer conversion
      const textExtensions = ['.env', '.txt', '.sh', '.conf', '.cfg', '.yaml', '.yml', '.json'];
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

  protected verifyBinary(binaryPath: string, version: string): boolean {
    try {
      if (!fs.existsSync(binaryPath)) return false;

      const dirName = path.basename(path.dirname(binaryPath));
      if (!dirName.includes(version)) return false;

      const filename = path.basename(binaryPath);
      if (!filename.includes(version)) return false;

      const stats = fs.statSync(binaryPath);
      if (stats.size < 1024 * 1024) return false;

      return true;
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // Protected: finalize env + cleanup
  // ===========================================================================

  protected finalizeEnv(stagingDir: string, downloadedEnvPath : string): string {
    if (fs.existsSync(downloadedEnvPath)) {
      fs.renameSync(downloadedEnvPath, path.join(stagingDir, '.env'));
      this.logger.log(`Renamed ${downloadedEnvPath} → .env`);
    }
    return path.join(stagingDir, '.env');
  }

  protected cleanupMacOSJunk(dirPath: string): void {
    const junkPatterns = ['.DS_Store', '._'];
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      if (file === '.DS_Store' || file.startsWith('._')) {
        fs.unlinkSync(path.join(dirPath, file));
        this.logger.log(`Removed macOS junk file: ${file}`);
      }
    }
  }

  protected safeDelete(...paths: string[]): void {
    for (const p of paths) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }

  /** Remove entire staging directory and all its contents. */
  protected cleanupStagingDir(dirPath: string): void {
    try {
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
        this.logger.log(`Cleaned up staging directory: ${dirPath}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to cleanup staging directory ${dirPath}: ${msg}`);
    }
  }
}
