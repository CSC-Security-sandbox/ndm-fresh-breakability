import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
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
import { v4 as uuidv4 } from 'uuid';
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
export class UpgradeService {
  private readonly logger: LoggerService;
  private readonly basePath: string;
  private readonly chunkSize: number = 100 * 1024 * 1024; // 100MB

  // In-memory session storage (consider Redis for production)
  private sessions: Map<string, UploadSession> = new Map();

  constructor(
    private readonly configService: ConfigService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    @InjectRepository(UpgradeBundle)
    private readonly upgradeBundleRepository: Repository<UpgradeBundle>,
  ) {
    this.logger = loggerFactory.create(UpgradeService.name);
    this.basePath = this.configService.get<string>('UPGRADE_BUNDLES_PATH') || '/upgrade-bundles';
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    const tempDir = path.join(this.basePath, 'temp');
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
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
      };
    }

    // Determine UI state based on latest record
    const showUploadUI =
      latest.uploadStatus === 'success' && latest.upgradeSuccess === true ||
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
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INIT: Create upload session, clean old files, create DB record
  // ═══════════════════════════════════════════════════════════════════════════
  async initUpload(dto: InitUploadDto): Promise<InitUploadResponseDto> {
    const uploadId = uuidv4();
    const totalChunks = Math.ceil(dto.fileSize / this.chunkSize);
    const tempDir = path.join(this.basePath, 'temp', uploadId);

    // Clean existing files (except temp directory)
    await this.cleanupDirectory();

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
  // FINALIZE: Assemble chunks and update DB status
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

      // Update DB record to success
      await this.upgradeBundleRepository.update(session.bundleId, {
        uploadStatus: 'success',
        filePath: finalPath,
        uploadCompletedAt: new Date(),
      });

      // Cleanup temp directory
      this.cleanupTempDir(session.tempDir);
      this.sessions.delete(uploadId);

      this.logger.log(`Upload finalized successfully: ${finalPath}`);

      return {
        success: true,
        path: finalPath,
        fileSize: session.fileSize,
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
  // CLEANUP: Remove all files except temp directory (called before new upload)
  // ═══════════════════════════════════════════════════════════════════════════
  async cleanupDirectory() {
    const files = fs.readdirSync(this.basePath);
    for (const file of files) {
      if (file === 'temp') continue; // Skip temp directory
      const filePath = path.join(this.basePath, file);
      const stat = fs.statSync(filePath);
      if (stat.isFile()) {
        fs.unlinkSync(filePath);
        this.logger.log(`Cleaned up old file: ${filePath}`);
      }
    }
    return { success: true, message: 'Directory cleaned' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TRIGGER UPGRADE: Called after upload is successful
  // ═══════════════════════════════════════════════════════════════════════════
  async triggerUpgrade(filePath: string, fileName?: string) {
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException(`Upgrade bundle not found at: ${filePath}`);
    }

    this.logger.log(`Triggering upgrade with bundle: ${filePath}`);

    // TODO: Add your upgrade logic here
    // This could be:
    // - Calling a shell script
    // - Triggering a Kubernetes job
    // - Sending message to another service

    // Update DB record to mark upgrade success
    const bundle = await this.upgradeBundleRepository.findOne({
      where: { filePath },
    });
    if (bundle) {
      await this.upgradeBundleRepository.update(bundle.id, {
        upgradeSuccess: true,
        upgradeCompletedAt: new Date(),
      });
    }

    return {
      success: true,
      message: 'Upgrade initiated',
      filePath,
      fileName,
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