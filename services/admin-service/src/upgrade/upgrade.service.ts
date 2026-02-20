import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  ConflictException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { Request } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn, exec } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { InitUploadDto, InitUploadResponseDto } from './dto/init-upload.dto';
import { UploadChunkResponseDto } from './dto/upload-chunk.dto';
import { UpgradeBundle } from '../entities/upgrade-bundle.entity';

// ═══════════════════════════════════════════════════════════════════════════
// In-memory store for active upload sessions
// In production, you might use Redis for multi-pod deployments
// ═══════════════════════════════════════════════════════════════════════════
interface UploadSession {
  uploadId: string;
  fileName: string;
  fileSize: number;
  checksum: string;
  chunkSize: number;
  totalChunks: number;
  receivedChunks: Set<number>;
  tempDir: string;
  createdAt: Date;
  bundleId: string; // DB record ID
}

@Injectable()
export class UpgradeService implements OnModuleInit {
  private readonly logger: LoggerService;
  private readonly basePath: string;
  private readonly deployPath: string;
  private readonly chunkSize: number = 100 * 1024 * 1024; // 100MB
  private readonly jobsServiceUrl: string;
  private static readonly UPGRADE_STALE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

  private sessions: Map<string, UploadSession> = new Map();

  private static readonly RUNNING_STATUSES = ['RUNNING', 'IN_PROGRESS', 'PENDING'];
  private static readonly SCHEDULED_STATUSES = ['SCHEDULED'];

  constructor(
    private readonly configService: ConfigService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    @InjectRepository(UpgradeBundle)
    private readonly upgradeBundleRepository: Repository<UpgradeBundle>,
  ) {
    this.logger = loggerFactory.create(UpgradeService.name);
    this.basePath = this.configService.get<string>('UPGRADE_BUNDLES_PATH') || '/upgrade-bundles';
    this.deployPath = this.configService.get<string>('UPGRADE_DEPLOY_PATH') || '/upgrade';
    this.jobsServiceUrl = this.configService.get<string>('JOBS_SERVICE_URL') || 'http://jobs-service:3000';
    this.ensureDirectories();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ON MODULE INIT: Log upgrade outcome written by ansible, handle stale records
  // Ansible writes success/rolled_back/failed to DB via psql.
  // This method only handles the edge case where ansible crashed without writing.
  // ═══════════════════════════════════════════════════════════════════════════
  async onModuleInit() {
    await this.checkUpgradeOutcome();
  }

  private async checkUpgradeOutcome(): Promise<void> {
    try {
      const latest = await this.upgradeBundleRepository.findOne({
        where: {},
        order: { created_at: 'DESC' },
      });

      if (!latest) return;

      switch (latest.upgradeStatus) {
        case 'success':
          this.logger.log(
            `Upgrade to ${latest.version} was successful. Worker upgrade is ready.`,
          );
          break;

        case 'rolled_back':
          this.logger.warn(
            `Upgrade to ${latest.version} failed and was rolled back to ${latest.installedCpVersion}.`,
          );
          break;

        case 'failed':
          this.logger.error(`Upgrade to ${latest.version} failed.`);
          break;

        case 'staged': {
          // Ansible hasn't written a result yet. Possible causes:
          // (a) ansible is still running on the host
          // (b) ansible crashed without writing to DB
          // (c) pod restarted before ansible started
          const stagedAt = new Date(latest.updated_at).getTime();
          const isStale = (Date.now() - stagedAt) > UpgradeService.UPGRADE_STALE_TIMEOUT_MS;

          if (isStale) {
            this.logger.error(
              `Staged upgrade to ${latest.version} has been pending for >30min with no result from ansible. Marking as failed.`,
            );
            await this.upgradeBundleRepository.update(latest.id, {
              upgradeStatus: 'failed',
              upgradeSuccess: false,
              upgradeCompletedAt: new Date(),
            });
          } else {
            this.logger.log(
              `Upgrade to ${latest.version} is staged. Ansible playbook may still be running on the host.`,
            );
          }
          break;
        }

        default:
          break;
      }
    } catch (error) {
      this.logger.error('Error checking upgrade outcome on startup', error);
    }
  }

  private ensureDirectories(): void {
    const tempDir = path.join(this.basePath, 'temp');
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    if (!fs.existsSync(this.deployPath)) {
      fs.mkdirSync(this.deployPath, { recursive: true });
    }
  }

  private extractVersionFromFileName(fileName: string): string | null {
    // Match patterns like: ndm-upgrade-v2.1.0.tar.gz or upgrade-1.2.3.zip
    return fileName
    .replace(/\.(tar\.gz|zip)$/i, '')  // Remove extension
    .replace(/^upgrade-/i, ''); 
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET LATEST UPLOAD STATUS - For UI state restoration after refresh
  // ═══════════════════════════════════════════════════════════════════════════
  async getLatestUploadStatus() {
    const latest = await this.upgradeBundleRepository.findOne({
      where: {},
      order: { created_at: 'DESC' },
    });

    if (!latest) {
      return {
        hasUpload: false,
        showUploadUI: true,
        showUpgradeUI: false,
        isUploadInProgress: false,
      };
    }

    // Check if there's an upload currently in progress
    // Status stays 'uploading' throughout: chunk upload + validation + organization
    let isUploadInProgress = latest.uploadStatus === 'uploading';

    // Handle stale uploads - if upload has been 'uploading' for more than 1 hour, mark as failed
    if (isUploadInProgress && latest.uploadStartedAt) {
      const uploadStartTime = new Date(latest.uploadStartedAt).getTime();
      const oneHourAgo = Date.now() - (60 * 60 * 1000); // 1 hour in milliseconds
      
      if (uploadStartTime < oneHourAgo) {
        this.logger.warn(`Marking stale upload as failed: ${latest.id}, started at ${latest.uploadStartedAt}`);
        await this.upgradeBundleRepository.update(latest.id, {
          uploadStatus: 'failed',
          uploadCompletedAt: new Date(),
        });
        // Update local state
        latest.uploadStatus = 'failed';
        isUploadInProgress = false;
      }
    }

    // Determine UI state based on latest record
    // Only show upload UI if: upgrade completed, upload failed, or upload cancelled
    // Do NOT show upload UI if upload is in progress or pending upgrade
    const showUploadUI =
      (latest.uploadStatus === 'success' && latest.upgradeSuccess === true) ||
      latest.uploadStatus === 'failed' ||
      latest.uploadStatus === 'cancelled';

    const showUpgradeUI =
      latest.uploadStatus === 'success' && latest.upgradeSuccess === false;

    return {
      hasUpload: true,
      uploadStatus: latest.uploadStatus,
      upgradeSuccess: latest.upgradeSuccess,
      fileName: latest.fileName,
      filePath: latest.filePath,
      fileSize: Number(latest.fileSize),
      version: latest.version,
      uploadCompletedAt: latest.uploadCompletedAt,
      upgradeCompletedAt: latest.upgradeCompletedAt,
      showUploadUI,
      showUpgradeUI,
      isUploadInProgress,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INIT: Create upload session, clean old files, create DB record
  // ═══════════════════════════════════════════════════════════════════════════
  async initUpload(dto: InitUploadDto): Promise<InitUploadResponseDto> {
    const uploadId = uuidv4();
    const totalChunks = Math.ceil(dto.fileSize / this.chunkSize);
    const tempDir = path.join(this.basePath, 'temp', uploadId);

    // Clean existing files for the same version only (keep other versions)
    await this.cleanupDirectory(dto.fileName);

    // Create temp directory for this upload's chunks
    fs.mkdirSync(tempDir, { recursive: true });

    // Extract version from filename
    const version = this.extractVersionFromFileName(dto.fileName);
    if (!version) {
      throw new BadRequestException('Invalid file name. Expected format: ndm-upgrade-v2.1.0.tar.gz or upgrade-1.2.3.zip');
    }
    // Create DB record with status 'uploading'
    const bundle = this.upgradeBundleRepository.create({
      fileName: dto.fileName,
      fileSize: dto.fileSize,
      uploadStatus: 'uploading',
      uploadStartedAt: new Date(),
      version,
    });
    const savedBundle = await this.upgradeBundleRepository.save(bundle);

    // Store session info
    const session: UploadSession = {
      uploadId,
      fileName: dto.fileName,
      fileSize: dto.fileSize,
      checksum: dto.checksum,
      chunkSize: this.chunkSize,
      totalChunks,
      receivedChunks: new Set(),
      tempDir,
      createdAt: new Date(),
      bundleId: savedBundle.id,
    };

    this.sessions.set(uploadId, session);

    this.logger.log(`Upload session initialized: ${uploadId}, DB record: ${savedBundle.id}`);

    return {
      uploadId,
      chunkSize: this.chunkSize,
      totalChunks,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CHUNK: Stream incoming chunk directly to disk
  // ═══════════════════════════════════════════════════════════════════════════
  async uploadChunk(
    uploadId: string,
    chunkIndex: number,
    req: Request,
  ): Promise<UploadChunkResponseDto> {
    const session = this.sessions.get(uploadId);
    if (!session) {
      throw new NotFoundException(`Upload session not found: ${uploadId}`);
    }

    if (chunkIndex < 0 || chunkIndex >= session.totalChunks) {
      throw new BadRequestException(
        `Invalid chunk index: ${chunkIndex}. Expected 0-${session.totalChunks - 1}`,
      );
    }

    const chunkPath = path.join(session.tempDir, `chunk_${String(chunkIndex).padStart(5, '0')}`);

    return new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(chunkPath);
      let bytesReceived = 0;

      req.on('data', (chunk: Buffer) => {
        bytesReceived += chunk.length;
      });

      req.pipe(writeStream);

      writeStream.on('finish', () => {
        session.receivedChunks.add(chunkIndex);
        this.logger.log(
          `Chunk ${chunkIndex}/${session.totalChunks - 1} received for ${uploadId} (${bytesReceived} bytes)`,
        );
        resolve({
          received: true,
          chunkIndex,
          bytesReceived,
        });
      });

      writeStream.on('error', (err) => {
        this.logger.error(`Error writing chunk ${chunkIndex}: ${err.message}`);
        reject(new InternalServerErrorException('Failed to write chunk'));
      });

      req.on('error', (err) => {
        this.logger.error(`Error receiving chunk ${chunkIndex}: ${err.message}`);
        writeStream.destroy();
        reject(new InternalServerErrorException('Failed to receive chunk'));
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATUS: Return current progress
  // ═══════════════════════════════════════════════════════════════════════════
  async getStatus(uploadId: string) {
    const session = this.sessions.get(uploadId);
    if (!session) {
      throw new NotFoundException(`Upload session not found: ${uploadId}`);
    }

    return {
      uploadId,
      fileName: session.fileName,
      fileSize: session.fileSize,
      totalChunks: session.totalChunks,
      receivedChunks: session.receivedChunks.size,
      progress: Math.round((session.receivedChunks.size / session.totalChunks) * 100),
      missingChunks: this.getMissingChunks(session),
    };
  }

  private getMissingChunks(session: UploadSession): number[] {
    const missing: number[] = [];
    for (let i = 0; i < session.totalChunks; i++) {
      if (!session.receivedChunks.has(i)) {
        missing.push(i);
      }
    }
    return missing;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FINALIZE: Assemble chunks, validate checksums, organize for deployment
  // ═══════════════════════════════════════════════════════════════════════════
  async finalizeUpload(uploadId: string) {
    const session = this.sessions.get(uploadId);
    if (!session) {
      throw new NotFoundException(`Upload session not found: ${uploadId}`);
    }

    if (session.receivedChunks.size !== session.totalChunks) {
      const missing = this.getMissingChunks(session);
      // Update DB to failed
      await this.upgradeBundleRepository.update(session.bundleId, {
        uploadStatus: 'failed',
        uploadCompletedAt: new Date(),
      });
      throw new BadRequestException(
        `Missing chunks: ${missing.join(', ')}. Received ${session.receivedChunks.size}/${session.totalChunks}`,
      );
    }

    const finalPath = path.join(this.basePath, session.fileName);

    this.logger.log(`Assembling ${session.totalChunks} chunks into ${finalPath}`);

    const writeStream = fs.createWriteStream(finalPath);

    try {
      // Step 1: Assemble chunks into final file
      for (let i = 0; i < session.totalChunks; i++) {
        const chunkPath = path.join(session.tempDir, `chunk_${String(i).padStart(5, '0')}`);

        await new Promise<void>((resolve, reject) => {
          const readStream = fs.createReadStream(chunkPath);
          readStream.on('error', reject);
          readStream.on('end', resolve);
          readStream.pipe(writeStream, { end: false });
        });

        this.logger.log(`Assembled chunk ${i + 1}/${session.totalChunks}`);
      }

      writeStream.end();

      await new Promise<void>((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      // Keep status as 'uploading' until validation completes
      // Status only becomes 'success' after everything is validated and organized
      await this.upgradeBundleRepository.update(session.bundleId, {
        filePath: finalPath,
      });

      // Cleanup temp directory
      this.cleanupTempDir(session.tempDir);
      this.sessions.delete(uploadId);

      this.logger.log(`Chunks assembled successfully: ${finalPath}`);

      // Step 2: Process the bundle (extract, validate checksums, organize files)
      // Only mark as 'success' after ALL steps complete
      this.logger.log('Starting bundle processing (extraction, validation, organization)...');
      const processingResult = await this.processUploadedBundle(session.bundleId);

      if (!processingResult.success) {
        return {
          success: false,
          path: finalPath,
          fileSize: session.fileSize,
          errors: processingResult.errors,
          message: 'Checksum validation failed',
        };
      }

      // NOW mark as success - only after validation and organization complete
      await this.upgradeBundleRepository.update(session.bundleId, {
        uploadStatus: 'success',
        uploadCompletedAt: new Date(),
      });

      this.logger.log(`Upload fully complete and validated: ${processingResult.deployPath}`);

      return {
        success: true,
        path: processingResult.deployPath,
        fileSize: session.fileSize,
        version: processingResult.version,
        message: 'Upload and validation successful, files organized for deployment',
      };
    } catch (error) {
      writeStream.destroy();
      if (fs.existsSync(finalPath)) {
        fs.unlinkSync(finalPath);
      }

      // Update DB to failed
      await this.upgradeBundleRepository.update(session.bundleId, {
        uploadStatus: 'failed',
        uploadCompletedAt: new Date(),
      });

      this.logger.error(`Finalize failed: ${error.message}`);
      throw new InternalServerErrorException(`Failed to assemble file: ${error.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CANCEL: Cleanup and update DB status
  // ═══════════════════════════════════════════════════════════════════════════
  async cancelUpload(uploadId: string) {
    const session = this.sessions.get(uploadId);
    if (!session) {
      throw new NotFoundException(`Upload session not found: ${uploadId}`);
    }

    // Update DB to cancelled
    await this.upgradeBundleRepository.update(session.bundleId, {
      uploadStatus: 'cancelled',
      uploadCompletedAt: new Date(),
    });

    this.cleanupTempDir(session.tempDir);
    this.sessions.delete(uploadId);

    this.logger.log(`Upload cancelled: ${uploadId}`);

    return { cancelled: true, uploadId };
  }

  private cleanupTempDir(tempDir: string): void {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLEANUP: Remove files for the same version only (keeps other versions)
  // ═══════════════════════════════════════════════════════════════════════════
  async cleanupDirectory(newFileName?: string) {
    // Extract version from the new file being uploaded
    const newVersion = newFileName
      ? newFileName
          .replace(/\.(tar\.gz|tgz|zip)$/i, '')
          .replace(/^upgrade-/i, '')
      : null;

    const files = fs.readdirSync(this.basePath);
    for (const file of files) {
      // Skip temp and extracted directories
      if (file === 'temp' || file === 'extracted') continue;

      const filePath = path.join(this.basePath, file);
      const stat = fs.statSync(filePath);

      if (stat.isFile()) {
        // Extract version from existing file
        const existingVersion = file
          .replace(/\.(tar\.gz|tgz|zip)$/i, '')
          .replace(/^upgrade-/i, '');

        // Only delete if same version OR no version specified (full cleanup)
        if (!newVersion || existingVersion === newVersion) {
          fs.unlinkSync(filePath);
          this.logger.log(
            `Cleaned up old file for version ${existingVersion}: ${filePath}`,
          );
        } else {
          this.logger.log(
            `Keeping file for different version ${existingVersion}: ${filePath}`,
          );
        }
      }
    }

    // Also clean up the same version folder in deploy path if it exists
    if (newVersion) {
      const versionDeployDir = path.join(this.deployPath, newVersion);
      if (fs.existsSync(versionDeployDir)) {
        fs.rmSync(versionDeployDir, { recursive: true, force: true });
        this.logger.log(
          `Cleaned up existing deployment for version ${newVersion}: ${versionDeployDir}`,
        );
      }
    }

    return { success: true, message: 'Directory cleaned for version' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXTRACT AND VALIDATE: Extract tar.gz/zip, validate checksums, organize files
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Detect archive type from file path
   */
  private getArchiveType(filePath: string): 'tar.gz' | 'zip' | 'unknown' {
    const lowerPath = filePath.toLowerCase();
    if (lowerPath.endsWith('.tar.gz') || lowerPath.endsWith('.tgz')) {
      return 'tar.gz';
    }
    if (lowerPath.endsWith('.zip')) {
      return 'zip';
    }
    return 'unknown';
  }

  /**
   * Extract archive to target directory (supports tar.gz and zip)
   */
  private async extractArchive(archivePath: string, targetDir: string): Promise<void> {
    const archiveType = this.getArchiveType(archivePath);

    // Ensure target directory exists
    fs.mkdirSync(targetDir, { recursive: true });

    switch (archiveType) {
      case 'tar.gz':
        return this.extractTarGz(archivePath, targetDir);
      case 'zip':
        return this.extractZip(archivePath, targetDir);
      default:
        throw new Error(`Unsupported archive type for file: ${archivePath}. Expected .tar.gz, .tgz, or .zip`);
    }
  }

  /**
   * Extract a tar.gz archive to a target directory using system tar
   */
  private async extractTarGz(archivePath: string, targetDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tar = spawn('tar', ['-xzf', archivePath, '-C', targetDir]);

      let stderr = '';
      tar.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      tar.on('close', (code) => {
        if (code === 0) {
          this.logger.log(`Successfully extracted tar.gz ${archivePath} to ${targetDir}`);
          resolve();
        } else {
          reject(new Error(`tar extraction failed with code ${code}: ${stderr}`));
        }
      });

      tar.on('error', (err) => {
        reject(new Error(`Failed to spawn tar: ${err.message}`));
      });
    });
  }

  /**
   * Extract a zip archive to a target directory using system unzip
   */
  private async extractZip(archivePath: string, targetDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use unzip command: unzip -o (overwrite) -q (quiet) archive.zip -d targetDir
      const unzip = spawn('unzip', ['-o', '-q', archivePath, '-d', targetDir]);

      let stderr = '';
      unzip.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      unzip.on('close', (code) => {
        if (code === 0) {
          this.logger.log(`Successfully extracted zip ${archivePath} to ${targetDir}`);
          resolve();
        } else {
          reject(new Error(`unzip extraction failed with code ${code}: ${stderr}`));
        }
      });

      unzip.on('error', (err) => {
        reject(new Error(`Failed to spawn unzip: ${err.message}`));
      });
    });
  }

  /**
   * Calculate SHA256 checksum of a file using streaming to handle large files
   */
  private async calculateFileChecksum(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', (err) => reject(err));
    });
  }

  /**
   * Parse checksums.sha256 file and return map of filename -> expected checksum
   * Format: <checksum>  <filename> (two spaces between checksum and filename)
   */
  private parseChecksumFile(checksumFilePath: string): Map<string, string> {
    const checksums = new Map<string, string>();
    const content = fs.readFileSync(checksumFilePath, 'utf-8');
    const lines = content.split('\n').filter((line) => line.trim());

    for (const line of lines) {
      // Format: <sha256hash>  <filename> (note: two spaces)
      const match = line.match(/^([a-fA-F0-9]{64})\s+(.+)$/);
      if (match) {
        const [, checksum, filename] = match;
        checksums.set(filename.trim(), checksum.toLowerCase());
      }
    }

    this.logger.log(`Parsed ${checksums.size} checksums from ${checksumFilePath}`);
    return checksums;
  }

  /**
   * Validate all files listed in checksums.sha256
   */
  private async validateChecksums(
    extractedDir: string,
    checksumMap: Map<string, string>,
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    for (const [filename, expectedChecksum] of checksumMap) {
      const filePath = path.join(extractedDir, filename);

      if (!fs.existsSync(filePath)) {
        errors.push(`Missing file: ${filename}`);
        continue;
      }

      try {
        const actualChecksum = await this.calculateFileChecksum(filePath);
        if (actualChecksum !== expectedChecksum) {
          errors.push(
            `Checksum mismatch for ${filename}: expected ${expectedChecksum}, got ${actualChecksum}`,
          );
        } else {
          this.logger.log(`Checksum valid for ${filename}`);
        }
      } catch (err) {
        errors.push(`Failed to calculate checksum for ${filename}: ${err.message}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Find the upgrade directory inside extracted contents
   * Supports two structures:
   * 1. upgrade-<version>/ folder inside the archive
   * 2. Contents directly in root (version extracted from filename)
   */
  private findUpgradeDirectory(
    extractedDir: string,
    fileName: string,
  ): { upgradeDir: string; version: string } | null {
    const entries = fs.readdirSync(extractedDir, { withFileTypes: true });

    // First, try to find upgrade-<version> folder inside
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('upgrade-')) {
        const version = entry.name.replace(/^upgrade-/, '');
        return {
          upgradeDir: path.join(extractedDir, entry.name),
          version,
        };
      }
    }

    // No upgrade- folder found, use extracted root directory
    // Extract version from original filename (e.g., "upgrade-2026.01.1.zip" -> "2026.01.1")
    const version = fileName
      .replace(/\.(tar\.gz|tgz|zip)$/i, '')
      .replace(/^upgrade-/i, '');

    this.logger.log(
      `No upgrade- folder found, using extracted root. Version from filename: ${version}`,
    );

    // Only fail if extraction resulted in empty directory
    if (entries.length === 0) {
      this.logger.error('Extraction resulted in empty directory');
      return null;
    }

    return {
      upgradeDir: extractedDir,
      version,
    };
  }

  /**
   * Copy file preserving directory structure
   */
  private copyFile(src: string, dest: string): void {
    const destDir = path.dirname(dest);
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, dest);
    this.logger.log(`Copied ${src} -> ${dest}`);
  }

  /**
   * Copy directory recursively
   */
  private copyDirectoryRecursive(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this.copyDirectoryRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
    this.logger.log(`Copied directory ${src} -> ${dest}`);
  }

  /**
   * Organize extracted files into deployment structure:
   * /upgrade/<version>/CP/ - docker/, helm/, upgrade.sh, checksums.sha256
   * /upgrade/<version>/worker/linux/ - linux worker files
   * /upgrade/<version>/worker/windows/ - windows worker files
   * 
   * Note: All directories are always created (even if empty).
   * Missing files/folders are logged but do not cause failure.
   */
  private async organizeForDeployment(
    upgradeDir: string,
    version: string,
  ): Promise<string> {
    const versionDeployDir = path.join(this.deployPath, version);
    const cpDir = path.join(versionDeployDir, 'CP');
    const cpDockerDir = path.join(cpDir, 'docker');
    const cpHelmDir = path.join(cpDir, 'helm');
    const workerLinuxDir = path.join(versionDeployDir, 'worker', 'linux');
    const workerWindowsDir = path.join(versionDeployDir, 'worker', 'windows');

    // Track missing items for logging
    const missingItems: string[] = [];

    // Clean existing deployment directory for this version
    if (fs.existsSync(versionDeployDir)) {
      fs.rmSync(versionDeployDir, { recursive: true, force: true });
      this.logger.log(`Cleaned existing deployment directory: ${versionDeployDir}`);
    }

    // Always create the full directory structure (even if empty)
    fs.mkdirSync(cpDockerDir, { recursive: true });
    fs.mkdirSync(cpHelmDir, { recursive: true });
    fs.mkdirSync(workerLinuxDir, { recursive: true });
    fs.mkdirSync(workerWindowsDir, { recursive: true });

    // Copy Control Plane files (only if they exist in source)
    const dockerDir = path.join(upgradeDir, 'docker');
    const helmDir = path.join(upgradeDir, 'helm');
    const upgradeScript = path.join(upgradeDir, 'upgrade.sh');
    const checksumFile = path.join(upgradeDir, 'checksums.sha256');

    if (fs.existsSync(dockerDir)) {
      this.copyDirectoryRecursive(dockerDir, cpDockerDir);
      this.logger.log('Found and copied: docker/');
    } else {
      missingItems.push('docker/');
    }

    if (fs.existsSync(helmDir)) {
      this.copyDirectoryRecursive(helmDir, cpHelmDir);
      this.logger.log('Found and copied: helm/');
    } else {
      missingItems.push('helm/');
    }

    if (fs.existsSync(upgradeScript)) {
      this.copyFile(upgradeScript, path.join(cpDir, 'upgrade.sh'));
      fs.chmodSync(path.join(cpDir, 'upgrade.sh'), 0o755);
      this.logger.log('Found and copied: upgrade.sh');
    } else {
      missingItems.push('upgrade.sh');
    }

    if (fs.existsSync(checksumFile)) {
      this.copyFile(checksumFile, path.join(cpDir, 'checksums.sha256'));
      this.logger.log('Found and copied: checksums.sha256');
    } else {
      missingItems.push('checksums.sha256');
    }

    // Copy Worker files (only if they exist in source)
    const workerDir = path.join(upgradeDir, 'worker');
    if (fs.existsSync(workerDir)) {
      this.logger.log('Found and processing: worker/');
      const workerFiles = fs.readdirSync(workerDir);

      for (const file of workerFiles) {
        const filePath = path.join(workerDir, file);
        const stat = fs.statSync(filePath);

        if (stat.isFile()) {
          // Determine target based on file extension/name
          if (file.endsWith('.exe') || file.endsWith('.msi') || file.includes('windows')) {
            this.copyFile(filePath, path.join(workerWindowsDir, file));
          } else if (
            file.endsWith('.tar.gz') ||
            file.endsWith('.deb') ||
            file.endsWith('.rpm') ||
            file.includes('linux')
          ) {
            this.copyFile(filePath, path.join(workerLinuxDir, file));
          } else {
            // Default to linux if unclear
            this.copyFile(filePath, path.join(workerLinuxDir, file));
          }
        } else if (stat.isDirectory()) {
          // Handle subdirectories like worker/linux/, worker/windows/
          if (file.toLowerCase() === 'linux') {
            this.copyDirectoryRecursive(filePath, workerLinuxDir);
          } else if (file.toLowerCase() === 'windows') {
            this.copyDirectoryRecursive(filePath, workerWindowsDir);
          }
        }
      }
    } else {
      missingItems.push('worker/');
    }

    // Log summary of missing items
    if (missingItems.length > 0) {
      this.logger.warn(
        `The following items were not found in the uploaded bundle: ${missingItems.join(', ')}`,
      );
    } else {
      this.logger.log('All expected items found in the uploaded bundle');
    }

    this.logger.log(`Organized files for deployment at: ${versionDeployDir}`);
    return versionDeployDir;
  }

  /**
   * Main method: Extract, validate checksums, and organize for deployment
   * Called after upload finalize to process the bundle
   */
  async processUploadedBundle(bundleId: string): Promise<{
    success: boolean;
    version?: string;
    deployPath?: string;
    errors?: string[];
  }> {
    // Get bundle from DB
    const bundle = await this.upgradeBundleRepository.findOne({
      where: { id: bundleId },
    });

    if (!bundle) {
      throw new NotFoundException(`Bundle not found: ${bundleId}`);
    }

    if (bundle.uploadStatus !== 'uploading') {
      throw new BadRequestException(
        `Bundle upload status is ${bundle.uploadStatus}, expected 'uploading'`,
      );
    }

    if (!bundle.filePath || !fs.existsSync(bundle.filePath)) {
      throw new NotFoundException(`Bundle file not found at: ${bundle.filePath}`);
    }

    const extractDir = path.join(this.basePath, 'extracted', bundleId);

    try {
      this.logger.log(`Processing uploaded bundle: ${bundle.filePath}`);

      // Step 1: Extract the archive (supports tar.gz and zip)
      this.logger.log('Step 1: Extracting archive...');
      await this.extractArchive(bundle.filePath, extractDir);

      // Step 2: Find the upgrade directory (folder or root)
      this.logger.log('Step 2: Locating upgrade directory...');
      const result = this.findUpgradeDirectory(extractDir, bundle.fileName);
      if (!result) {
        throw new Error(
          'Invalid bundle structure: extraction resulted in empty directory',
        );
      }

      const { upgradeDir, version } = result;
      this.logger.log(`Found upgrade directory: ${upgradeDir}, version: ${version}`);

      // Step 3: Parse and validate checksums
      this.logger.log('Step 3: Validating checksums...');
      const checksumFile = path.join(upgradeDir, 'checksums.sha256');
      if (!fs.existsSync(checksumFile)) {
        throw new Error('checksums.sha256 not found in upgrade bundle');
      }

      const checksumMap = this.parseChecksumFile(checksumFile);
      const validation = await this.validateChecksums(upgradeDir, checksumMap);

      if (!validation.valid) {
        // Update DB with validation failure
        await this.upgradeBundleRepository.update(bundleId, {
          uploadStatus: 'failed',
        });

        return {
          success: false,
          errors: validation.errors,
        };
      }

      this.logger.log('All checksums validated successfully');

      // Step 4: Organize files for deployment
      this.logger.log('Step 4: Organizing files for deployment...');
      const deployDir = await this.organizeForDeployment(upgradeDir, version);

      // Step 5: Update DB with version and deployment path
      await this.upgradeBundleRepository.update(bundleId, {
        version,
        filePath: deployDir, // Update to deployment path
      });

      // Step 6: Cleanup extraction directory
      this.logger.log('Step 6: Cleaning up extraction directory...');
      fs.rmSync(extractDir, { recursive: true, force: true });

      this.logger.log(`Bundle processing complete. Deploy path: ${deployDir}`);

      return {
        success: true,
        version,
        deployPath: deployDir,
      };
    } catch (error) {
      // Cleanup on error
      if (fs.existsSync(extractDir)) {
        fs.rmSync(extractDir, { recursive: true, force: true });
      }

      this.logger.error(`Bundle processing failed: ${error.message}`);

      // Update DB with failure
      await this.upgradeBundleRepository.update(bundleId, {
        uploadStatus: 'failed',
      });

      throw new InternalServerErrorException(
        `Failed to process bundle: ${error.message}`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TRIGGER UPGRADE: Check jobs → stage in DB → fire ansible via nsenter
  // ═══════════════════════════════════════════════════════════════════════════
  async triggerUpgrade(filePath: string, fileName?: string) {
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException(`Upgrade bundle not found at: ${filePath}`);
    }

    // Step 1: Check if another upgrade is already staged/in-progress
    const existingStaged = await this.upgradeBundleRepository.findOne({
      where: { upgradeStatus: 'staged' },
    });
    if (existingStaged) {
      throw new ConflictException(
        `An upgrade is already in progress for version ${existingStaged.version}`,
      );
    }

    // Step 2: Check for running and scheduled jobs via jobs-service
    const jobCheckResult = await this.checkBlockingJobs();

    if (jobCheckResult.runningJobs.length > 0) {
      throw new ConflictException({
        message: 'Cannot upgrade — migration/cutover jobs are currently running. Wait for them to complete or cancel them.',
        type: 'RUNNING_JOBS',
        jobs: jobCheckResult.runningJobs,
      });
    }

    if (jobCheckResult.scheduledJobs.length > 0) {
      throw new ConflictException({
        message: 'Cannot upgrade — scheduled jobs are active. Please deactivate all scheduled jobs before upgrading.',
        type: 'SCHEDULED_JOBS',
        jobs: jobCheckResult.scheduledJobs,
      });
    }

    // Step 3: Get bundle record and determine versions
    const bundle = await this.upgradeBundleRepository.findOne({
      where: { filePath },
      order: { created_at: 'DESC' },
    });
    if (!bundle) {
      throw new NotFoundException(`No bundle record found for path: ${filePath}`);
    }

    // Step 4: Validate version format to prevent command injection
    const buildVersion = bundle.version;
    if (!buildVersion || !/^[\w.\-]+$/.test(buildVersion)) {
      throw new BadRequestException(
        `Invalid version format: ${buildVersion}. Only alphanumeric, dots, hyphens, and underscores are allowed.`,
      );
    }

    // Step 5: Stage the upgrade in DB
    // installed_cp_version is set later by the ansible playbook (it knows the deployed version)
    await this.upgradeBundleRepository.update(bundle.id, {
      upgradeStatus: 'staged',
    });

    this.logger.log(
      `Upgrade staged: bundle=${bundle.id}, target=${bundle.version}`,
    );

    // Step 6: Fire ansible-playbook on the HOST via nsenter (fire and forget)
    const playbookPath = path.join(this.deployPath, 'upgrade-playbook.yaml');
    const logFile = path.join(this.deployPath, `upgrade-${buildVersion}.log`);
    const bundleId = bundle.id;

    const nsenterCmd =
      `nsenter -t 1 -m -u -i -n -p -- bash -c ` +
      `'nohup ansible-playbook ${playbookPath} ` +
      `--extra-vars "build_version=${buildVersion}" ` +
      `> ${logFile} 2>&1 &'`;

    this.logger.log(`Executing upgrade on host: ${nsenterCmd}`);

    exec(nsenterCmd, (error, _stdout, stderr) => {
      if (error) {
        this.logger.error(`Failed to start upgrade process: ${error.message}`);
        this.logger.error(`stderr: ${stderr}`);
        this.upgradeBundleRepository.update(bundleId, {
          upgradeStatus: 'failed',
          upgradeSuccess: false,
          upgradeCompletedAt: new Date(),
        }).catch((dbErr) => {
          this.logger.error(`Failed to update DB after nsenter failure: ${dbErr.message}`);
        });
      } else {
        this.logger.log('Upgrade process started on host successfully');
      }
    });

    return {
      success: true,
      message: 'Upgrade initiated. The system will restart during the upgrade process.',
      bundleId: bundle.id,
      targetVersion: bundle.version,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CHECK BLOCKING JOBS: Query jobs-service for running/scheduled jobs
  // ═══════════════════════════════════════════════════════════════════════════
  private async checkBlockingJobs(): Promise<{
    runningJobs: any[];
    scheduledJobs: any[];
  }> {
    try {
      const response = await axios.get(`${this.jobsServiceUrl}/job-run`, {
        timeout: 10000,
      });

      const allJobRuns = response.data?.data?.items || response.data?.data || response.data || [];

      const runningJobs = allJobRuns.filter((job: any) =>
        UpgradeService.RUNNING_STATUSES.includes(job.status?.toUpperCase()),
      );

      const scheduledJobs = allJobRuns.filter((job: any) =>
        UpgradeService.SCHEDULED_STATUSES.includes(job.status?.toUpperCase()),
      );

      this.logger.log(
        `Job check: ${allJobRuns.length} total, ${runningJobs.length} running, ${scheduledJobs.length} scheduled`,
      );

      return { runningJobs, scheduledJobs };
    } catch (error) {
      this.logger.error(`Failed to query jobs-service: ${error.message}`);
      throw new InternalServerErrorException(
        'Unable to check job status. Ensure jobs-service is running before upgrading.',
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET UPGRADE STATUS: For UI to poll after reconnecting post-upgrade
  // ═══════════════════════════════════════════════════════════════════════════
  async getUpgradeStatus() {
    const latest = await this.upgradeBundleRepository.findOne({
      where: {},
      order: { created_at: 'DESC' },
    });

    if (!latest || latest.upgradeStatus === 'pending') {
      return { upgradeStatus: 'none' };
    }

    const workerUpgradeReady = latest.upgradeStatus === 'success';

    return {
      upgradeStatus: latest.upgradeStatus,
      targetVersion: latest.version,
      previousVersion: latest.installedCpVersion,
      upgradeCompletedAt: latest.upgradeCompletedAt,
      workerUpgradeReady,
      workerLinuxPath: workerUpgradeReady
        ? path.join(this.deployPath, latest.version, 'worker', 'linux')
        : null,
      workerWindowsPath: workerUpgradeReady
        ? path.join(this.deployPath, latest.version, 'worker', 'windows')
        : null,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET HISTORY: Returns all upload records for audit
  // ═══════════════════════════════════════════════════════════════════════════
  async getUploadHistory(limit: number = 10) {
    return this.upgradeBundleRepository.find({
      order: { created_at: 'DESC' },
      take: limit,
    });
  }
}