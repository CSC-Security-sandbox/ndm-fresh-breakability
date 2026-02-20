import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  OnModuleInit,
  StreamableFile,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import { createReadStream } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import { v4 as uuidv4, v4 as uuid } from 'uuid';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

// Upload (Control Plane) imports
import { Request } from 'express';
import { InitUploadDto, InitUploadResponseDto, UploadChunkResponseDto } from './dto/upgrade.dto';
import { UpgradeBundle } from '../entities/upgrade-bundle.entity';
import { UploadStatus, UpgradeStatus, WorkerAggregateStatus } from './enums/upgrade.enums';

// Worker multicast imports
import { WorkflowService } from '../workflow/workflow.service';
import { WorkFlows } from '../workflow/workflow.types';
import {
  MulticastRequestDto,
  MulticastResponseDto,
  MulticastStatusDto,
  WorkerAckDto,
  ExecuteUpgradeRequestDto,
  ExecuteUpgradeResponseDto,
  ExecutionStatusDto,
  ExecutionAckDto,
  WorkerExecutionStatusDto,
} from './dto/multicast.dto';
import { WorkerEntity } from '../entities/worker.entity';
import { UpgradeBundleStatus, UpgradeExecutionStatus } from '../constants/worker.enums';

/**
 * Base path for upgrade bundles on CP.
 * Structure: /upgrade/{version}/worker/{linux|windows|env}/
 */
const CP_UPGRADE_BASE = '/upgrade';

/**
 * Task queue for parent workflows
 */
const PARENT_TASK_QUEUE = 'ParentWorkflow-TaskQueue';

/** Max seconds since last health check to consider a worker healthy. */
const WORKER_HEALTH_TIMEOUT_SECONDS = 20; // window of 3 pings from worker 

// UploadSession type for Control Plane chunked upload
interface UploadSession {
  uploadId: string;
  fileName: string;
  fileSize: number;
  chunkSize: number;
  totalChunks: number;
  receivedChunks: Set<number>;
  tempDir: string;
  createdAt: Date;
  bundleId: string; // DB record ID
}

@Injectable()
export class UpgradeService implements OnModuleInit {
  // UPLOAD (Control Plane) fields
  private readonly logger: LoggerService;
  private readonly uploadPath: string;
  private readonly chunkSize: number = 15 * 1024 * 1024; // 15MB

  private sessions: Map<string, UploadSession> = new Map();

  // MULTICAST (Worker Distribution) fields
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(UpgradeBundle)
    private readonly upgradeBundleRepository: Repository<UpgradeBundle>,
    // Worker multicast
    private readonly workflowService: WorkflowService,
    @InjectRepository(WorkerEntity)
    private readonly workerRepository: Repository<WorkerEntity>,
    @Inject(LoggerFactory) private loggerFactory: LoggerFactory, // Only used for worker multicast logger init
  ) {
    this.logger = loggerFactory.create(UpgradeService.name);
    this.uploadPath = this.configService.getOrThrow<string>('UPLOAD_PATH');
  }

  // === UPGRADE UPLOAD FLOW ==
  async onModuleInit(): Promise<void> {
    await this.ensureDirectories();
  }

  // Helper to check if path exists (async replacement for existsSync)
  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await fsPromises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // Ensure required directories exist with proper error handling (#7)
  private async ensureDirectories(): Promise<void> {
    try {
      const tempDir = path.join(this.uploadPath, 'temp');
      if (!(await this.pathExists(this.uploadPath))) {
        await fsPromises.mkdir(this.uploadPath, { recursive: true });
        this.logger.log(`Created upload directory: ${this.uploadPath}`);
      }
      if (!(await this.pathExists(tempDir))) {
        await fsPromises.mkdir(tempDir, { recursive: true });
        this.logger.log(`Created temp directory: ${tempDir}`);
      }
    } catch (error) {
      this.logger.error(`Failed to create required directories: ${error.message}`);
      throw new InternalServerErrorException(
        `Failed to initialize upload directories. Please check disk space and permissions: ${error.message}`
      );
    }
  }

  /**
   * Check if an upload record is stale (timed out)
   * Used to detect abandoned uploads that can be safely overwritten
   */
  private isUploadStale(record: UpgradeBundle): boolean {
    if (!record.uploadStartedAt) return true;

    if (record.uploadStatus === UploadStatus.UPLOADING) {
      const timeout = this.calculateUploadTimeout(Number(record.fileSize));
      const elapsed = Date.now() - new Date(record.uploadStartedAt).getTime();
      return elapsed > timeout;
    }

    if (record.uploadStatus === UploadStatus.PROCESSING) {
      // Use processingStartedAt if available, fallback to uploadStartedAt
      const startTime = record.processingStartedAt
        ? new Date(record.processingStartedAt).getTime()
        : new Date(record.uploadStartedAt).getTime();
      const PROCESSING_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes
      const elapsed = Date.now() - startTime;
      return elapsed > PROCESSING_TIMEOUT_MS;
    }

    return false;
  }

  private extractVersionFromFileName(fileName: string): string | null {
    // Match pattern: upgrade-v2.1.0.tar.gz
    // Trim to handle any whitespace issues
    return fileName
      .replace(/\.tar\.gz$/i, '')  // Remove .tar.gz extension
      .replace(/^upgrade-/i, '')   // Remove upgrade- prefix
      .trim();                     // Remove any whitespace
  }


  private calculateUploadTimeout(fileSize: number): number {
    const MIN_TIMEOUT_MS = 30 * 60 * 1000;       // 30 minutes minimum
    const MAX_TIMEOUT_MS = 12 * 60 * 60 * 1000;  // 12 hours maximum
    const UPLOAD_SPEED_BYTES_PER_SEC = 1 * 1024 * 1024;  // 1 MB/s for upload

    // Upload time (file transfer)
    const uploadTimeMs = (fileSize / UPLOAD_SPEED_BYTES_PER_SEC) * 1000;
    
    // Total timeout = upload + processing
    const calculatedTimeout = uploadTimeMs;
    
    return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, calculatedTimeout));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET LATEST UPLOAD STATUS - For UI state restoration after refresh
  // ═══════════════════════════════════════════════════════════════════════════
  async getLatestUploadStatus() {
    try {
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
          isProcessing: false,
        };
      }

    // Check if there's an upload currently in progress (chunks being uploaded)
      let isUploadInProgress = latest.uploadStatus === UploadStatus.UPLOADING;
    
    // Check if processing is in progress (extraction, validation, organization)
      let isProcessing = latest.uploadStatus === UploadStatus.PROCESSING;

    // Handle stale uploads - timeout based on file size (only for UPLOADING)
      if (isUploadInProgress && latest.uploadStartedAt) {
        const timeout = this.calculateUploadTimeout(Number(latest.fileSize));
        const elapsed = Date.now() - new Date(latest.uploadStartedAt).getTime();
        if (elapsed > timeout) {
          await this.upgradeBundleRepository.update(latest.id, {
            uploadStatus: UploadStatus.FAILED,
            uploadCompletedAt: new Date(),
          });
          isUploadInProgress = false;
        }
      }

    // Handle stale PROCESSING status - timeout for extraction/validation
      if (isProcessing) {
      const PROCESSING_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes max for processing
      
      // Use processingStartedAt if available, fallback to uploadStartedAt for older records
        const processingStart = latest.processingStartedAt || latest.uploadStartedAt;

        if (processingStart) {
          const elapsed = Date.now() - new Date(processingStart).getTime();
          if (elapsed > PROCESSING_TIMEOUT_MS) {
            this.logger.warn(`Processing timeout for bundle ${latest.id} after ${Math.round(elapsed / 60000)} minutes`);
            await this.upgradeBundleRepository.update(latest.id, {
              uploadStatus: UploadStatus.FAILED,
              uploadCompletedAt: new Date(),
            });
            isProcessing = false;
          }
        }
      }

    // Determine UI state based on latest record
    // Show upload UI if: upgrade completed successfully, upload failed, or upload cancelled
    // NOTE: Do NOT include upgrade failed here - user must click "Start Over" first
      const showUploadUI =
        (latest.uploadStatus === UploadStatus.SUCCESS && latest.upgradeStatus === UpgradeStatus.SUCCESS) ||
        latest.uploadStatus === UploadStatus.FAILED ||
        latest.uploadStatus === UploadStatus.CANCELLED;

    // Show upgrade UI if: upload succeeded AND upgrade is pending OR failed (allow retry)
      const showUpgradeUI =
        latest.uploadStatus === UploadStatus.SUCCESS &&
        (latest.upgradeStatus === UpgradeStatus.PENDING || latest.upgradeStatus === UpgradeStatus.FAILED);

    // Check if upgrade is currently in progress
      const isUpgradeInProgress =
        latest.uploadStatus === UploadStatus.SUCCESS &&
        latest.upgradeStatus === UpgradeStatus.IN_PROGRESS;

      return {
        hasUpload: true,
      bundleId: latest.id,       // Use bundleId for triggerUpgrade instead of filePath
        uploadStatus: latest.uploadStatus,
        upgradeStatus: latest.upgradeStatus,
        fileName: latest.fileName,
        fileSize: Number(latest.fileSize),
        version: latest.version,
        uploadCompletedAt: latest.uploadCompletedAt,
        upgradeCompletedAt: latest.upgradeCompletedAt,
        uploadedBy: latest.uploadedBy,
        upgradedBy: latest.upgradedBy,
        showUploadUI,
        showUpgradeUI,
      isUploadInProgress,       // true when chunks are being uploaded (can be cancelled)
      isProcessing,             // true when extracting/validating (should NOT be cancelled)
        isUpgradeInProgress,
      };
    } catch (error) {
      this.logger.error(`Failed to get latest upload status: ${error.message}`);
      // Return safe defaults on error to allow UI to function
      return {
        hasUpload: false,
        showUploadUI: true,
        showUpgradeUI: false,
        isUploadInProgress: false,
        isProcessing: false,
        error: 'Failed to load status',
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INIT: Create upload session, clean old files, create DB record
  // ═══════════════════════════════════════════════════════════════════════════
  async initUpload(dto: InitUploadDto, userId?: string): Promise<InitUploadResponseDto> {
    // ═══════════════════════════════════════════════════════════════════════════
    // CHECK FOR EXISTING UPLOAD IN PROGRESS - Block concurrent uploads
    // ═══════════════════════════════════════════════════════════════════════════
    const existingUpload = await this.upgradeBundleRepository.findOne({
      where: [
        { uploadStatus: UploadStatus.UPLOADING },
        { uploadStatus: UploadStatus.PROCESSING },
      ],
      order: { created_at: 'DESC' },
    });

    if (existingUpload) {
      // Check if it's actually stale (timed out)
      const isStale = this.isUploadStale(existingUpload);

      if (!isStale) {
        const statusMsg = existingUpload.uploadStatus === UploadStatus.PROCESSING
          ? 'processing (extraction/validation)'
          : 'uploading';
        throw new BadRequestException(
          `Another upload is already ${statusMsg}. File: "${existingUpload.fileName}". ` +
          `Please wait for it to complete or cancel it before starting a new upload.`
        );
      }

      // If stale, mark it as failed so we can proceed with new upload
      this.logger.warn(`Found stale upload ${existingUpload.id}, marking as failed`);
      await this.upgradeBundleRepository.update(existingUpload.id, {
        uploadStatus: UploadStatus.FAILED,
        uploadCompletedAt: new Date(),
      });
    }

    // Validate file extension - only .tar.gz is supported
    if (!dto.fileName.toLowerCase().endsWith('.tar.gz')) {
      throw new BadRequestException(
        `Invalid file type. Only .tar.gz files are supported. Received: ${dto.fileName}`
      );
    }

    // Extract and validate version from filename
    const version = this.extractVersionFromFileName(dto.fileName);
    if (!version) {
      throw new BadRequestException(
        'Invalid file name format. Expected: upgrade-{version}.tar.gz (e.g., upgrade-v2.1.0.tar.gz)'
      );
    }

    // Validate file size
    if (!dto.fileSize || dto.fileSize <= 0) {
      throw new BadRequestException('Invalid file size');
    }

    const uploadId = uuidv4();
    const totalChunks = Math.ceil(dto.fileSize / this.chunkSize);
    // Single temp directory for uploads (only one upload at a time)
    const tempDir = path.join(this.uploadPath, 'temp');
    const chunksDir = path.join(tempDir, 'chunks');
    let savedBundle: UpgradeBundle | null = null;

    try {
      // Clear entire temp directory for fresh upload
      if (await this.pathExists(tempDir)) {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }

      // Clean existing version folder if re-uploading same version
      await this.cleanupVersionFolder(dto.fileName);

      // Create temp directory structure for this upload
      await fsPromises.mkdir(chunksDir, { recursive: true });

      // Create DB record with status UPLOADING
      const bundle = this.upgradeBundleRepository.create({
        fileName: dto.fileName,
        fileSize: dto.fileSize,
        uploadStatus: UploadStatus.UPLOADING,
        uploadStartedAt: new Date(),
        version,
          uploadedBy: userId, // Track who uploaded the bundle
      });
      savedBundle = await this.upgradeBundleRepository.save(bundle);

    // Store session info
      const session: UploadSession = {
        uploadId,
        fileName: dto.fileName,
        fileSize: dto.fileSize,
        chunkSize: this.chunkSize,
        totalChunks,
        receivedChunks: new Set(),
        tempDir,
        createdAt: new Date(),
        bundleId: savedBundle.id,
      };

      this.sessions.set(uploadId, session);

      this.logger.debug(`Upload session initialized: ${uploadId}, DB record: ${savedBundle.id}`);

      return {
        uploadId,
        chunkSize: this.chunkSize,
        totalChunks,
      };
    } catch (error) {
      // Cleanup temp directory if created
      try {
        if (await this.pathExists(tempDir)) {
          await fsPromises.rm(tempDir, { recursive: true, force: true });
        }
      } catch (cleanupError) {
        this.logger.error(`Failed to cleanup temp directory: ${cleanupError.message}`);
      }

      // Mark DB record as failed if it was created
      if (savedBundle) {
        try {
          await this.upgradeBundleRepository.update(savedBundle.id, {
            uploadStatus: UploadStatus.FAILED,
            uploadCompletedAt: new Date(),
          });
        } catch (dbError) {
          this.logger.error(`Failed to update DB record on init failure: ${dbError.message}`);
        }
      }

      this.logger.error(`Failed to initialize upload: ${error.message}`);
      throw new InternalServerErrorException(`Failed to initialize upload: ${error.message}`);
    }
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

    // Chunks go under /upload/temp/chunks/
    const chunkPath = path.join(session.tempDir, 'chunks', `chunk_${String(chunkIndex).padStart(5, '0')}`);

    return new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(chunkPath);
      let bytesReceived = 0;
      let isCompleted = false; // Track if upload completed successfully

      req.on('data', (chunk: Buffer) => {
        bytesReceived += chunk.length;
      });

      req.pipe(writeStream);

      writeStream.on('finish', () => {
        isCompleted = true;
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
        
        // Update DB to FAILED immediately on write error (disk full, permission, etc.)
        this.upgradeBundleRepository.update(session.bundleId, {
          uploadStatus: UploadStatus.FAILED,
          uploadCompletedAt: new Date(),
        }).catch(dbErr => {
          this.logger.error(`Failed to update DB on write error: ${dbErr.message}`);
        });
        
        // Cleanup session
        this.sessions.delete(uploadId);
        
        reject(new InternalServerErrorException('Failed to write chunk'));
      });

      req.on('error', (err) => {
        this.logger.error(`Error receiving chunk ${chunkIndex}: ${err.message}`);
        writeStream.destroy();
        
        // Update DB to FAILED immediately on error
        this.upgradeBundleRepository.update(session.bundleId, {
          uploadStatus: UploadStatus.FAILED,
          uploadCompletedAt: new Date(),
        }).catch(dbErr => {
          this.logger.error(`Failed to update DB on error: ${dbErr.message}`);
        });
        
        // Cleanup session
        this.sessions.delete(uploadId);
        
        reject(new InternalServerErrorException('Failed to receive chunk'));
      });

      // Handle request abort (user refresh, tab close, network disconnect)
      req.on('close', () => {
        if (!isCompleted) {
          this.logger.warn(`Request aborted for chunk ${chunkIndex}, upload ${uploadId}`);
          writeStream.destroy();
          
          // Update DB to FAILED immediately on abort
          this.upgradeBundleRepository.update(session.bundleId, {
            uploadStatus: UploadStatus.FAILED,
            uploadCompletedAt: new Date(),
          }).catch(dbErr => {
            this.logger.error(`Failed to update DB on abort: ${dbErr.message}`);
          });
          
          // Cleanup session
          this.sessions.delete(uploadId);
          
          reject(new InternalServerErrorException('Request aborted'));
        }
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
  // PROCESS UPLOAD: Assemble chunks, validate checksums, organize for deployment
  // ═══════════════════════════════════════════════════════════════════════════
  async processUpload(uploadId: string) {
    const session = this.sessions.get(uploadId);
    if (!session) {
      throw new NotFoundException(`Upload session not found: ${uploadId}`);
    }

    if (session.receivedChunks.size !== session.totalChunks) {
      const missing = this.getMissingChunks(session);
      // Update DB to failed
      await this.upgradeBundleRepository.update(session.bundleId, {
        uploadStatus: UploadStatus.FAILED,
        uploadCompletedAt: new Date(),
      });
      throw new BadRequestException(
        `Missing chunks: ${missing.join(', ')}. Received ${session.receivedChunks.size}/${session.totalChunks}`,
      );
    }

    // Assembled bundle goes to /upload/temp/{filename}
    const finalPath = path.join(session.tempDir, session.fileName);

    this.logger.log(`Assembling ${session.totalChunks} chunks into ${finalPath}`);

    try {
      // Remove existing file if it exists (from a previous failed attempt)
      if (await this.pathExists(finalPath)) {
        await fsPromises.unlink(finalPath);
      }

      // Step 1: Assemble chunks into final file (sequentially to maintain order)
      for (let i = 0; i < session.totalChunks; i++) {
        const chunkPath = path.join(session.tempDir, 'chunks', `chunk_${String(i).padStart(5, '0')}`);

        // Read chunk and append to output file asynchronously (sequential for order)
        const chunkData = await fsPromises.readFile(chunkPath);
        await fsPromises.appendFile(finalPath, chunkData);

        this.logger.debug(`Assembled chunk ${i + 1}/${session.totalChunks} (${chunkData.length} bytes)`);
      }

      // Mark as PROCESSING (extraction/validation in progress)
      // This helps UI distinguish between "stuck upload" vs "actively processing"
      await this.upgradeBundleRepository.update(session.bundleId, {
        uploadStatus: UploadStatus.PROCESSING,
        processingStartedAt: new Date(),  // Track when processing started for timeout calculation
      });

      // Delete chunks directory only (keep assembled archive for processing)
      const chunksDir = path.join(session.tempDir, 'chunks');
      if (await this.pathExists(chunksDir)) {
        await fsPromises.rm(chunksDir, { recursive: true, force: true });
      }

      this.logger.log(`Chunks assembled successfully: ${finalPath}`);

      // Step 2: Process the bundle (extract, validate checksums, organize files)
      // Pass file path directly - no extra DB query needed!
      this.logger.debug('Starting bundle processing (extraction, validation, organization)...');
      const processingResult = await this.processUploadedBundle(finalPath, session.fileName);

      // Now cleanup entire temp directory (archive no longer needed)
      await this.cleanupTempDir(session.tempDir);
      this.sessions.delete(uploadId);

      if (!processingResult.success) {
        // Update DB to failed when validation fails
        await this.upgradeBundleRepository.update(session.bundleId, {
          uploadStatus: UploadStatus.FAILED,
          uploadCompletedAt: new Date(),
        });
        
        return {
          success: false,
          path: finalPath,
          fileSize: session.fileSize,
          errors: processingResult.errors,
          message: 'Checksum validation failed',
        };
      }

      await this.upgradeBundleRepository.update(session.bundleId, {
        uploadStatus: UploadStatus.SUCCESS,
        uploadCompletedAt: new Date(),
        version: processingResult.version,  // Store version for path derivation
      });

      this.logger.log(`Upload fully complete and validated: ${processingResult.deployPath}`);

      return {
        success: true,
        path: processingResult.deployPath,
        bundleId: session.bundleId,  // Return bundleId for triggerUpgrade
        fileSize: session.fileSize,
        version: processingResult.version,
        message: 'Upload and validation successful, files organized for deployment',
      };
    } catch (error) {
      // Cleanup assembled file if it exists
      try {
        if (await this.pathExists(finalPath)) {
          await fsPromises.unlink(finalPath);
        }
      } catch (cleanupError) {
        this.logger.error(`Failed to cleanup assembled file: ${cleanupError.message}`);
      }

      // Cleanup entire temp directory on failure
      await this.cleanupTempDir(session.tempDir);
      this.sessions.delete(uploadId);

      // Update DB to failed (with its own error handling)
      try {
        await this.upgradeBundleRepository.update(session.bundleId, {
          uploadStatus: UploadStatus.FAILED,
          uploadCompletedAt: new Date(),
        });
      } catch (dbError) {
        // The stale UPLOADING record will be handled by timeout mechanism
        this.logger.error(`Failed to update DB to FAILED status: ${dbError.message}`);
      }

      this.logger.error(`Process upload failed: ${error.message}`);
      throw new InternalServerErrorException(`Failed to assemble file: ${error.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CANCEL: Cleanup and update DB status
  // ═══════════════════════════════════════════════════════════════════════════
  async cancelUpload(uploadId: string) {
    const session = this.sessions.get(uploadId);

    // If session not found in memory, it may have been lost due to pod restart
    if (!session) {
      this.logger.warn(`Cancel requested for unknown session: ${uploadId}. Session may have expired or pod restarted.`);

      // Try to cleanup temp directory anyway (in case session was lost but files remain)
      const tempDir = path.join(this.uploadPath, 'temp');
      await this.cleanupTempDir(tempDir);

      // This handles the case where session was lost but DB record exists
      try {
        const uploadingRecord = await this.upgradeBundleRepository.findOne({
          where: { uploadStatus: UploadStatus.UPLOADING },
          order: { created_at: 'DESC' },
        });

        if (uploadingRecord) {
          await this.upgradeBundleRepository.update(uploadingRecord.id, {
            uploadStatus: UploadStatus.CANCELLED,
            uploadCompletedAt: new Date(),
          });
          this.logger.log(`Cancelled stale DB record: ${uploadingRecord.id}`);
        }
      } catch (dbError) {
        this.logger.error(`Failed to cancel stale DB record: ${dbError.message}`);
        // Continue anyway - timeout will eventually handle it
      }

      return {
        cancelled: true,
        uploadId,
        message: 'Session not found, but cleanup attempted'
      };
    }

    try {
    // Update DB to cancelled
      await this.upgradeBundleRepository.update(session.bundleId, {
        uploadStatus: UploadStatus.CANCELLED,
        uploadCompletedAt: new Date(),
      });
    } catch (dbError) {
      this.logger.error(`Failed to update DB on cancel: ${dbError.message}`);
      // Continue with cleanup even if DB update fails
    }

    await this.cleanupTempDir(session.tempDir);
    this.sessions.delete(uploadId);

    this.logger.log(`Upload cancelled: ${uploadId}`);

    return { cancelled: true, uploadId };
  }

  private async cleanupTempDir(tempDir: string): Promise<void> {
    try {
      if (await this.pathExists(tempDir)) {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      } else {
        this.logger.debug(`Temp directory does not exist: ${tempDir}`);
      }
    } catch (error) {
      this.logger.error(`Failed to cleanup temp directory ${tempDir}: ${error.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLEANUP: Remove deployed version folder for re-upload (keeps other versions)
  // ═══════════════════════════════════════════════════════════════════════════
  private async cleanupVersionFolder(newFileName?: string) {
    const newVersion = newFileName
      ? this.extractVersionFromFileName(newFileName)
      : null;

    // Clean up the same version folder if it exists (e.g., /upload/2026.01.1)
    if (newVersion) {
      const versionDir = path.join(this.uploadPath, newVersion);
      try {
        if (await this.pathExists(versionDir)) {
          await fsPromises.rm(versionDir, { recursive: true, force: true });
        } else {
          this.logger.debug(`No existing version folder found at: ${versionDir}`);
        }
      } catch (error) {
        this.logger.error(`Failed to cleanup version folder ${versionDir}: ${error.message}`);
        throw new InternalServerErrorException(
          `Failed to cleanup existing version folder. The folder may be in use or you may lack permissions: ${error.message}`
        );
      }
    }

    return { success: true, message: 'Directory cleaned for version' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXTRACT AND VALIDATE: Extract tar.gz, validate checksums, organize files
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Extract tar.gz archive to target directory using system tar
   */
  private async extractArchive(archivePath: string, targetDir: string): Promise<void> {
    // Ensure target directory exists
    await fsPromises.mkdir(targetDir, { recursive: true });

    return new Promise((resolve, reject) => {
      const tar = spawn('tar', ['-xzf', archivePath, '-C', targetDir]);

      let stderr = '';
      tar.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      tar.on('close', (code) => {
        if (code === 0) {
          this.logger.log(`Successfully extracted ${archivePath} to ${targetDir}`);
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
   */
  private async parseChecksumFile(checksumFilePath: string): Promise<Map<string, string>> {
    try {
      const checksums = new Map<string, string>();
      const content = await fsPromises.readFile(checksumFilePath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());

      if (lines.length === 0) {
        throw new BadRequestException('Checksum file is empty');
      }

      let validEntries = 0;
      let invalidLines: string[] = [];

      for (const line of lines) {
        // Format: <sha256hash>  <filename> (note: two spaces)
        const match = line.match(/^([a-fA-F0-9]{64})\s+(.+)$/);
        if (match) {
          const [, checksum, filename] = match;
          checksums.set(filename.trim(), checksum.toLowerCase());
          validEntries++;
        } else {
          // Track invalid lines for debugging (limit to first 5)
          if (invalidLines.length < 5) {
            invalidLines.push(line.substring(0, 50) + (line.length > 50 ? '...' : ''));
          }
        }
      }

      if (validEntries === 0) {
        this.logger.error(`No valid checksum entries found. Sample invalid lines: ${invalidLines.join(', ')}`);
        throw new BadRequestException(
          'Invalid checksum file format. No valid entries found. Expected format: <sha256hash>  <filename>'
        );
      }

      if (invalidLines.length > 0) {
        this.logger.warn(`Skipped ${lines.length - validEntries} invalid lines in checksum file`);
      }

      this.logger.log(`Parsed ${checksums.size} checksums from ${checksumFilePath}`);
      return checksums;
    } catch (error) {
      // Re-throw BadRequestException as-is
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Failed to parse checksum file: ${error.message}`);
      throw new BadRequestException(
        `Failed to read checksum file: ${error.message}. The file may be corrupted or have incorrect encoding.`
      );
    }
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

      if (!(await this.pathExists(filePath))) {
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
          this.logger.debug(`Checksum valid for ${filename}`);
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
  private async findUpgradeDirectory(
    extractedDir: string,
    fileName: string,
  ): Promise<{ upgradeDir: string; version: string } | null> {
    const entries = await fsPromises.readdir(extractedDir, { withFileTypes: true });

    // First, try to find upgrade-<version> folder inside
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('upgrade-')) {
        // Trim to handle folder names with trailing spaces (e.g., "upgrade-2026.01.1 ")
        const rawVersion = entry.name.replace(/^upgrade-/, '');
        const version = rawVersion.trim();
        
        // Warn if folder name has trailing/leading whitespace
        if (rawVersion !== version) {
          this.logger.warn(`Folder name has whitespace issues: "${entry.name}" - using trimmed version: "${version}"`);
        }
        
        return {
          upgradeDir: path.join(extractedDir, entry.name),
          version,
        };
      }
    }

    // No upgrade- folder found, use extracted root directory
    // Extract version from original filename (e.g., "upgrade-2026.01.1.tar.gz" -> "2026.01.1")
    const version = fileName
      .replace(/\.tar\.gz$/i, '')
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
   * Copy file preserving directory structure with error handling (#9)
   */
  private async copyFile(src: string, dest: string): Promise<void> {
    try {
      const destDir = path.dirname(dest);
      await fsPromises.mkdir(destDir, { recursive: true });
      await fsPromises.copyFile(src, dest);
      this.logger.debug(`Copied ${src} -> ${dest}`);
    } catch (error) {
      const fileName = path.basename(src);
      this.logger.error(`Failed to copy file ${src} to ${dest}: ${error.message}`);
      throw new InternalServerErrorException(
        `Failed to copy file '${fileName}': ${error.message}. Check disk space and permissions.`
      );
    }
  }

  /**
   * Copy directory recursively with error handling (#9)
   */
  private async copyDirectoryRecursive(src: string, dest: string): Promise<void> {
    try {
      await fsPromises.mkdir(dest, { recursive: true });
      const entries = await fsPromises.readdir(src, { withFileTypes: true });

      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
          await this.copyDirectoryRecursive(srcPath, destPath);
        } else {
          await fsPromises.copyFile(srcPath, destPath);
        }
      }
      this.logger.debug(`Copied directory ${src} -> ${dest}`);
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      const dirName = path.basename(src);
      this.logger.error(`Failed to copy directory ${src} to ${dest}: ${error.message}`);
      throw new InternalServerErrorException(
        `Failed to copy directory '${dirName}': ${error.message}. Check disk space and permissions.`
      );
    }
  }

  /**
   * Organize extracted files into deployment structure:
   * /upload/<version>/checksums.sha256 - checksum file at version root
   * /upload/<version>/CP/ - docker/, helm/, upgrade.sh
   * /upload/<version>/worker/linux/ - linux worker files
   * /upload/<version>/worker/windows/ - windows worker files
   */
  private async organizeForDeployment(
    upgradeDir: string,
    version: string,
  ): Promise<string> {
    const versionDeployDir = path.join(this.uploadPath, version);
    const cpDir = path.join(versionDeployDir, 'CP');
    const cpDockerDir = path.join(cpDir, 'docker');
    const cpHelmDir = path.join(cpDir, 'helm');
    const workerLinuxDir = path.join(versionDeployDir, 'worker', 'linux');
    const workerWindowsDir = path.join(versionDeployDir, 'worker', 'windows');

    // Track missing items for logging
    const missingItems: string[] = [];

    // Clean existing deployment directory for this version
    if (await this.pathExists(versionDeployDir)) {
      await fsPromises.rm(versionDeployDir, { recursive: true, force: true });
      this.logger.log(`Cleaned existing deployment directory: ${versionDeployDir}`);
    }

    // Always create the full directory structure (even if empty)
    await fsPromises.mkdir(cpDockerDir, { recursive: true });
    await fsPromises.mkdir(cpHelmDir, { recursive: true });
    await fsPromises.mkdir(workerLinuxDir, { recursive: true });
    await fsPromises.mkdir(workerWindowsDir, { recursive: true });

    // Copy Control Plane files (only if they exist in source)
    const dockerDir = path.join(upgradeDir, 'docker');
    const helmDir = path.join(upgradeDir, 'helm');
    const upgradeScript = path.join(upgradeDir, 'upgrade.sh');
    const checksumFile = path.join(upgradeDir, 'checksums.sha256');

    if (await this.pathExists(dockerDir)) {
      await this.copyDirectoryRecursive(dockerDir, cpDockerDir);
      this.logger.debug('Found and copied: docker/');
    } else {
      missingItems.push('docker/');
    }

    if (await this.pathExists(helmDir)) {
      await this.copyDirectoryRecursive(helmDir, cpHelmDir);
      this.logger.debug('Found and copied: helm/');
    } else {
      missingItems.push('helm/');
    }

    if (await this.pathExists(upgradeScript)) {
      await this.copyFile(upgradeScript, path.join(cpDir, 'upgrade.sh'));
      await fsPromises.chmod(path.join(cpDir, 'upgrade.sh'), 0o755);
      this.logger.debug('Found and copied: upgrade.sh');
    } else {
      missingItems.push('upgrade.sh');
    }

    if (await this.pathExists(checksumFile)) {
      // Checksum file goes at version root level, not in CP/
      await this.copyFile(checksumFile, path.join(versionDeployDir, 'checksums.sha256'));
      this.logger.debug('Found and copied: checksums.sha256 to version root');
    } else {
      missingItems.push('checksums.sha256');
    }

    // Copy Worker files 
    const workerDir = path.join(upgradeDir, 'worker');
    if (await this.pathExists(workerDir)) {
      this.logger.debug('Found and processing: worker/');
      const workerFiles = await fsPromises.readdir(workerDir);

      for (const file of workerFiles) {
        const filePath = path.join(workerDir, file);
        const stat = await fsPromises.stat(filePath);

        if (stat.isFile()) {
          // Determine target based on file name
          if (file.includes('windows')) {
            await this.copyFile(filePath, path.join(workerWindowsDir, file));
          } else if (
            file.includes('linux')
          ) {
            await this.copyFile(filePath, path.join(workerLinuxDir, file));
          } else {
            // Default to linux if unclear
            await this.copyFile(filePath, path.join(workerLinuxDir, file));
          }
        } else if (stat.isDirectory()) {
          // Handle subdirectories like worker/linux/, worker/windows/
          if (file.toLowerCase() === 'linux') {
            await this.copyDirectoryRecursive(filePath, workerLinuxDir);
          } else if (file.toLowerCase() === 'windows') {
            await this.copyDirectoryRecursive(filePath, workerWindowsDir);
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
   */
  private async processUploadedBundle(
    assembledFilePath: string,
    fileName: string,
  ): Promise<{
    success: boolean;
    version?: string;
    deployPath?: string;
    errors?: string[];
  }> {
    // Validate file exists
    if (!assembledFilePath || !(await this.pathExists(assembledFilePath))) {
      throw new NotFoundException(`Bundle file not found at: ${assembledFilePath}`);
    }

    // Extract into /upload/temp/extracted/
    const tempDir = path.dirname(assembledFilePath);
    const extractDir = path.join(tempDir, 'extracted');

    try {
      this.logger.log(`Processing uploaded bundle: ${assembledFilePath}`);

      // Step 1: Extract the tar.gz archive
      this.logger.debug('Step 1: Extracting archive...');
      await this.extractArchive(assembledFilePath, extractDir);

      // Step 2: Find the upgrade directory (folder or root)
      this.logger.debug('Step 2: Locating upgrade directory...');
      const result = await this.findUpgradeDirectory(extractDir, fileName);
      if (!result) {
        throw new Error(
          'Invalid bundle structure: extraction resulted in empty directory',
        );
      }

      const { upgradeDir, version } = result;
      this.logger.debug(`Found upgrade directory: ${upgradeDir}, version: ${version}`);

      // Step 3: Parse and validate checksums
      this.logger.debug('Step 3: Validating checksums...');
      const checksumFile = path.join(upgradeDir, 'checksums.sha256');
      if (!(await this.pathExists(checksumFile))) {
        throw new Error('checksums.sha256 not found in upgrade bundle');
      }

      const checksumMap = await this.parseChecksumFile(checksumFile);
      const validation = await this.validateChecksums(upgradeDir, checksumMap);

      if (!validation.valid) {
        return {
          success: false,
          errors: validation.errors,
        };
      }

      this.logger.log('All checksums validated successfully');

      // Step 4: Organize files for deployment
      this.logger.debug('Step 4: Organizing files for deployment...');
      const deployDir = await this.organizeForDeployment(upgradeDir, version);

      // Step 5: Cleanup extraction directory
      this.logger.debug('Step 5: Cleaning up extraction directory...');
      await fsPromises.rm(extractDir, { recursive: true, force: true });

      this.logger.log(`Bundle processing complete. Deploy path: ${deployDir}`);

      return {
        success: true,
        version,
        deployPath: deployDir,
      };
    } catch (error) {
      // Cleanup on error with proper error handling
      try {
        if (await this.pathExists(extractDir)) {
          await fsPromises.rm(extractDir, { recursive: true, force: true });
        }
      } catch (cleanupError) {
        this.logger.error(`Failed to cleanup extraction directory: ${cleanupError.message}`);
      }

      this.logger.error(`Bundle processing failed: ${error.message}`);


      // Re-throw NestJS exceptions as-is
      if (error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException) {
        throw error;
      }

      throw new InternalServerErrorException(
        `Failed to process bundle: ${error.message}`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TRIGGER UPGRADE: Called after upload is successful
  // Uses bundleId (primary key) instead of filePath for faster, safer queries
  // ═══════════════════════════════════════════════════════════════════════════
  async triggerUpgrade(bundleId: string, userId?: string) {
    // Validate bundleId is provided
    if (!bundleId || bundleId.trim() === '') {
      throw new BadRequestException('Bundle ID is required to trigger upgrade');
    }

    this.logger.log(`Triggering upgrade for bundle: ${bundleId}`);

    // Find the bundle record by ID (primary key - fast query)
    const bundle = await this.upgradeBundleRepository.findOne({
      where: { id: bundleId },
    });

    if (!bundle) {
      throw new NotFoundException(
        `Bundle not found with ID: ${bundleId}. The upload may have failed or been deleted.`
      );
    }

    // Validate bundle is in correct state (upload successful)
    if (bundle.uploadStatus !== UploadStatus.SUCCESS) {
      throw new BadRequestException(
        `Cannot upgrade bundle with upload status: ${bundle.uploadStatus}. Upload must be successful first.`
      );
    }

    // Validate version exists (needed to construct deploy path)
    if (!bundle.version) {
      throw new BadRequestException(
        'Bundle version not found. The upload may not have been processed correctly.'
      );
    }

    // Pattern: /upload/${version}  (e.g., /upload/v2.1.0)
    const deployPath = path.join(this.uploadPath, bundle.version);

    // Validate deploy directory exists on disk
    if (!(await this.pathExists(deployPath))) {
      throw new NotFoundException(`Upgrade bundle not found at: ${deployPath}`);
    }

    // Check if upgrade is already in progress
    if (bundle.upgradeStatus === UpgradeStatus.IN_PROGRESS) {
      throw new BadRequestException('An upgrade is already in progress');
    }

    try {
      // TODO: Add your upgrade logic here
      // This could be:
      // - Calling a shell script
      // - Triggering a Kubernetes job
      // - Sending message to another service
      // 
      // The bundle deploy path is: deployPath (derived from version)
      // The version is: bundle.version

      // Update DB record to mark upgrade success
      await this.upgradeBundleRepository.update(bundle.id, {
        upgradeStatus: UpgradeStatus.SUCCESS,
        upgradeCompletedAt: new Date(),
        upgradedBy: userId,
      });
      this.logger.log(`Updated bundle ${bundle.id} with upgradeStatus=${UpgradeStatus.SUCCESS}, upgradedBy=${userId}`);

      return {
        success: true,
        message: 'Upgrade initiated',
        bundleId: bundle.id,
        version: bundle.version,
        fileName: bundle.fileName,
      };
    } catch (error) {
      // If it's already a NestJS exception, re-throw it
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(`Failed to trigger upgrade: ${error.message}`);
      throw new InternalServerErrorException(
        `Failed to trigger upgrade: ${error.message}`
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SKIP UPGRADE: Called when user clicks Reset after successful upload
  // Marks the upgrade as skipped to avoid orphaned "pending" records
  // ═══════════════════════════════════════════════════════════════════════════
  async skipUpgrade(bundleId: string) {
    // Validate bundleId is provided
    if (!bundleId || bundleId.trim() === '') {
      throw new BadRequestException('Bundle ID is required to skip upgrade');
    }

    this.logger.log(`Skipping upgrade for bundle: ${bundleId}`);

    // Find the bundle record by ID (primary key - fast query)
    const bundle = await this.upgradeBundleRepository.findOne({
      where: { id: bundleId },
    });

    if (!bundle) {
      // Bundle not found - might have been deleted, just return success
      this.logger.warn(`Bundle not found for skip: ${bundleId}`);
      return {
        success: true,
        message: 'Bundle not found, nothing to skip',
      };
    }

    // Only skip if upload was successful and upgrade is still pending
    if (bundle.uploadStatus !== UploadStatus.SUCCESS) {
      return {
        success: false,
        message: `Cannot skip upgrade for bundle with upload status: ${bundle.uploadStatus}`,
      };
    }

    if (bundle.upgradeStatus !== UpgradeStatus.PENDING) {
      return {
        success: false,
        message: `Cannot skip upgrade with status: ${bundle.upgradeStatus}. Only pending upgrades can be skipped.`,
      };
    }

    // Mark upgrade as skipped
    await this.upgradeBundleRepository.update(bundle.id, {
      upgradeStatus: UpgradeStatus.SKIPPED,
    });

    this.logger.log(`Upgrade skipped for bundle: ${bundleId}`);

    return {
      success: true,
      message: 'Upgrade skipped successfully',
      bundleId: bundle.id,
    };
  }

  // === WORKER BUNDLE MULTICAST =

  // Helper functions for worker upgrade bundle streaming
  // Sanitize version string to prevent path traversal attacks.
  private sanitizeVersion(version: string): string {
    if (!version || !/^[a-zA-Z0-9._-]+$/.test(version)) {
      throw new BadRequestException(
        `Invalid version string: ${version}. Only alphanumeric, dots, dashes, and underscores allowed.`,
      );
    }
    return version;
  }

  private cpBundlePath(version: string, platform: 'linux' | 'windows'): string {
    if (platform !== 'linux' && platform !== 'windows') {
      throw new BadRequestException(`Invalid platform: ${platform}. Must be 'linux' or 'windows'.`);
    }
    const safeVersion = this.sanitizeVersion(version);
    const resolved = path.resolve(CP_UPGRADE_BASE, safeVersion, 'worker', platform);

    if (!resolved.startsWith(path.resolve(CP_UPGRADE_BASE))) {
      throw new BadRequestException(`Invalid version path: ${version}`);
    }
    return resolved;
  }

  private async checkBundleInfo(version: string, platform: 'linux' | 'windows'): Promise<{
    available: boolean;
    filename?: string;
    size?: number;
  }> {
    const basePath = this.cpBundlePath(version, platform);

    try {
      await fsPromises.access(basePath);
    } catch {
      return { available: false };
    }

    const files = await fsPromises.readdir(basePath);
    const bundleFile = files.find((f) =>
      f.startsWith(`datamigrator-worker-${platform}-`) && (f.endsWith('.tar.gz') || f.endsWith('.zip')),
    );

    if (!bundleFile) {
      return { available: false };
    }

    const stat = await fsPromises.stat(path.join(basePath, bundleFile));
    return { available: true, filename: bundleFile, size: stat.size };
  }

  private async validateBundlesExist(version: string): Promise<{
    linux: { available: boolean; filename?: string; size?: number };
    windows: { available: boolean; filename?: string; size?: number };
  }> {
    const [linux, windows] = await Promise.all([
      this.checkBundleInfo(version, 'linux'),
      this.checkBundleInfo(version, 'windows'),
    ]);

    if (!linux.available && !windows.available) {
      throw new BadRequestException(
        `No upgrade bundles found for version ${version}. Expected files in ${this.cpBundlePath(version, 'linux')} or ${this.cpBundlePath(version, 'windows')}`,
      );
    }

    this.logger.log(
      `Precheck passed for version ${version}: linux=${linux.available}, windows=${windows.available}`,
    );

    return { linux, windows };
  }

  async startMulticast(
    dto: MulticastRequestDto,
  ): Promise<MulticastResponseDto> {
    const traceId = uuid();
    const workflowId = `BinaryMulticast-${traceId}`;
    let workerIds: string[] = [];
    try {
      await this.validateBundlesExist(dto.version);

      const cutoff = new Date(Date.now() - WORKER_HEALTH_TIMEOUT_SECONDS * 1000);
      const activeWorkers = await this.workerRepository
        .createQueryBuilder('worker')
        .innerJoinAndSelect('worker.stats', 'stats')
        .where('worker.status = :status', { status: 'Online' })
        .andWhere('stats.updated_at > :cutoff', { cutoff })
        .getMany();

      if (activeWorkers.length === 0) {
        return {
          workflowId,
          status: 'error',
          message: 'No healthy workers found. Workers must be Online and reporting health checks.',
        };
      }

      this.logger.log(`Health check: ${activeWorkers.length} healthy worker(s) found`);

      workerIds = activeWorkers.map((w) => w.workerId);

      this.logger.log(
        `Starting multicast workflow: ${workflowId} for ${workerIds.length} active workers, version ${dto.version}`,
      );

      await this.workerRepository.update(
        { workerId: In(workerIds) },
        { upgradeBundleStaged: UpgradeBundleStatus.IN_PROGRESS , stagedVersion: dto.version },
      );
      this.logger.log(`Set upgrade_bundle_staged=IN_PROGRESS for ${workerIds.length} workers`);

      const handle = await this.workflowService.startWorkflow(
        WorkFlows.BINARY_MULTICAST,
        {
          taskQueue: PARENT_TASK_QUEUE,
          workflowId,
          args: [
            {
              traceId,
              workerIds,
              version: dto.version,
            },
          ],
        },
      );

      this.logger.log(
        `Multicast workflow started: ${handle.workflowId}, runId: ${handle.firstExecutionRunId}`,
      );

      await this.upgradeBundleRepository.update(dto.bundleId, {
        multicastWorkflowId: handle.workflowId,
        workerUploadStatus: WorkerAggregateStatus.IN_PROGRESS,
      });
      this.logger.log(`Stored multicast_workflow_id=${handle.workflowId}, worker_upload_status=IN_PROGRESS on bundle ${dto.bundleId}`);

      return {
        workflowId: handle.workflowId,
        status: 'started',
        message: `Multicast workflow started for ${workerIds.length} active workers`,
      };
    } catch (error) {
      this.logger.error(`Failed to start multicast workflow: ${error}`);

      if (error instanceof BadRequestException) {
        throw error;
      }
      if (workerIds?.length) {
        try {
          await this.workerRepository.update(
            { workerId: In(workerIds) },
            { upgradeBundleStaged: UpgradeBundleStatus.IDLE, stagedVersion: null },
          );
          this.logger.log(`Reset upgrade_bundle_staged=IDLE for ${workerIds.length} workers after workflow start failure`);
        } catch (resetError) {
          this.logger.error(`Failed to reset worker status after workflow start failure: ${resetError}`);
        }
      }

      return {
        workflowId,
        status: 'error',
        message: error.message,
      };
    }
  }

  async acknowledgeWorkerDownload(
    dto: WorkerAckDto,
  ): Promise<{ acknowledged: boolean }> {
    this.logger.log(
      `Worker ${dto.workerId} ack: ${dto.status} for version ${dto.version}`,
    );

    if (dto.status === 'success') {
      await this.workerRepository.update(dto.workerId, {
        upgradeBundleStaged: UpgradeBundleStatus.COMPLETED,
      });
      this.logger.log(`Set upgrade_bundle_staged=COMPLETED for worker ${dto.workerId}`);
    } else {
      await this.workerRepository.update(dto.workerId, {
        upgradeBundleStaged: UpgradeBundleStatus.FAILED,
        stagedVersion: null,
      });
      this.logger.log(`Worker ${dto.workerId} reported failure: ${dto.message}`);
    }

    // Check if all workers with this version are done (no more IN_PROGRESS)
    const remaining = await this.workerRepository.count({
      where: {
        stagedVersion: dto.version,
        upgradeBundleStaged: UpgradeBundleStatus.IN_PROGRESS,
      },
    });
    if (remaining === 0) {
      await this.upgradeBundleRepository.update(
        { version: dto.version },
        { workerUploadStatus: WorkerAggregateStatus.COMPLETED },
      );
      this.logger.log(`All workers done for version ${dto.version}, worker_upload_status=COMPLETED`);
    }

    return { acknowledged: true };
  }

  async getMulticastStatus(bundleId: string, version: string): Promise<MulticastStatusDto> {
    this.logger.log(`Getting multicast status for bundle ${bundleId}, version ${version}`);

    const bundle = await this.upgradeBundleRepository.findOne({
      where: { id: bundleId, version },
    });

    if (!bundle?.multicastWorkflowId) {
      throw new NotFoundException(`No multicast workflow found for bundle ${bundleId}, version ${version}`);
    }

    const workflowId = bundle.multicastWorkflowId;
    const workflowData = await this.workflowService.getWorkflowStatus(workflowId);

    const workers = await this.workerRepository.find({
      relations: ['stats'],
    });

    const healthTimeout = WORKER_HEALTH_TIMEOUT_SECONDS;
    const now = new Date();

    const workerStatuses = workers.map((w) => {
      const lastSeen = w.stats?.updatedAt ? new Date(w.stats.updatedAt) : null;
      const healthy = lastSeen
        ? Math.floor(Math.abs(now.getTime() - lastSeen.getTime()) / 1000) < healthTimeout
        : false;

      return {
        workerId: w.workerId,
        workerName: w.workerName,
        ipAddress: w.ipAddress,
        platform: w.platform,
        currentVersion: w.workerVersion,
        stagedVersion: w.stagedVersion,
        bundleStatus: w.upgradeBundleStaged,
        healthy,
        lastSeen: lastSeen?.toISOString(),
      };
    });

    const summary = {
      total: workerStatuses.length,
      completed: workerStatuses.filter((w) => w.bundleStatus === UpgradeBundleStatus.COMPLETED).length,
      inProgress: workerStatuses.filter((w) => w.bundleStatus === UpgradeBundleStatus.IN_PROGRESS).length,
      failed: workerStatuses.filter((w) => w.bundleStatus === UpgradeBundleStatus.FAILED).length,
      idle: workerStatuses.filter((w) => w.bundleStatus === UpgradeBundleStatus.IDLE).length,
    };

    const workflowResult = workflowData.status === 'COMPLETED' ? workflowData.completed : undefined;

    return {
      workflowId,
      workflowStatus: workflowData.status,
      summary,
      workers: workerStatuses,
      workflowResult,
    };
  }

  // =========================================================================
  // Upgrade Execution
  // =========================================================================

  /** Trigger upgrade execution on all workers where bundles are staged. */
  async startExecution(
    dto: ExecuteUpgradeRequestDto,
  ): Promise<ExecuteUpgradeResponseDto> {
    const traceId = uuid();
    const workflowId = `UpgradeExecution-${traceId}`;
    let workerIds: string[] = [];

    try {
      const stagedWorkers = await this.workerRepository.find({
        where: {
          upgradeBundleStaged: UpgradeBundleStatus.COMPLETED,
          stagedVersion: dto.version,
        },
      });

      if (stagedWorkers.length === 0) {
        return {
          workflowId,
          status: 'error',
          message: `No workers have completed binary staging for version ${dto.version}`,
        };
      }

      workerIds = stagedWorkers.map((w) => w.workerId);

      this.logger.log(
        `Starting execution workflow: ${workflowId} for ${workerIds.length} staged workers, version ${dto.version}`,
      );

      await this.workerRepository.update(
        { workerId: In(workerIds) },
        { upgradeExecutionStatus: UpgradeExecutionStatus.IN_PROGRESS },
      );

      await this.workflowService.startWorkflow(
        WorkFlows.UPGRADE_EXECUTION,
        {
          taskQueue: PARENT_TASK_QUEUE,
          workflowId,
          args: [{ traceId, workerIds, version: dto.version }],
        },
      );

      this.logger.log(`Execution workflow started: ${workflowId}`);

      await this.upgradeBundleRepository.update(dto.bundleId, {
        executionWorkflowId: workflowId,
        upgradeWorkerTriggeredAt: new Date(),
        workerUpgradeStatus: WorkerAggregateStatus.IN_PROGRESS,
      });
      this.logger.log(`Stored execution_workflow_id=${workflowId}, worker_upgrade_status=IN_PROGRESS on bundle ${dto.bundleId}`);

      return {
        workflowId,
        status: 'started',
        message: `Upgrade execution triggered for ${workerIds.length} workers`,
        triggeredWorkers: workerIds,
      };
    } catch (error) {
      this.logger.error(`Failed to start execution workflow: ${error}`);

      if (workerIds?.length) {
        try {
          await this.workerRepository.update(
            { workerId: In(workerIds) },
            { upgradeExecutionStatus: UpgradeExecutionStatus.IDLE },
          );
        } catch (resetError) {
          this.logger.error(`Failed to reset execution status: ${resetError}`);
        }
      }

      if (error instanceof BadRequestException) throw error;

      return { workflowId, status: 'error', message: error.message };
    }
  }

  /** Get upgrade execution status. After 5-minute window, marks remaining as timed out. */
  async getExecutionStatus(bundleId: string, version: string): Promise<ExecutionStatusDto> {
    const EXECUTION_WINDOW_MS = 5 * 60 * 1000;

    const bundle = await this.upgradeBundleRepository.findOne({
      where: { id: bundleId, version },
    });

    if (!bundle?.executionWorkflowId) {
      throw new NotFoundException(`No execution workflow found for bundle ${bundleId}, version ${version}`);
    }

    const workflowId = bundle.executionWorkflowId;
    const workflowData = await this.workflowService.getWorkflowStatus(workflowId);

    const allWorkers = await this.workerRepository.find();

    // Workers involved in execution (IN_PROGRESS, COMPLETED, FAILED)
    const executionWorkers = allWorkers.filter(
      (w) => w.upgradeExecutionStatus !== UpgradeExecutionStatus.IDLE,
    );

    const triggeredAt = bundle.upgradeWorkerTriggeredAt
      ? new Date(bundle.upgradeWorkerTriggeredAt).getTime()
      : Date.now();
    const elapsed = Date.now() - triggeredAt;
    const windowElapsed = elapsed >= EXECUTION_WINDOW_MS;

    if (windowElapsed) {
      const stillInProgress = executionWorkers.filter(
        (w) => w.upgradeExecutionStatus === UpgradeExecutionStatus.IN_PROGRESS,
      );
      if (stillInProgress.length > 0) {
        await this.workerRepository.update(
          { workerId: In(stillInProgress.map((w) => w.workerId)) },
          { upgradeExecutionStatus: UpgradeExecutionStatus.FAILED },
        );
        stillInProgress.forEach((w) => {
          w.upgradeExecutionStatus = UpgradeExecutionStatus.FAILED;
        });
        this.logger.log(
          `Timed out ${stillInProgress.length} workers after 5-minute window`,
        );
      }
    }

    const toDto = (w: WorkerEntity): WorkerExecutionStatusDto => ({
      workerId: w.workerId,
      workerName: w.workerName,
      ipAddress: w.ipAddress,
      platform: w.platform,
      currentVersion: w.workerVersion,
      executionStatus: w.upgradeExecutionStatus,
      upgradeCompletedAt: w.upgradeCompletedAt?.toISOString(),
    });

    const completed = allWorkers.filter(
      (w) => w.upgradeExecutionStatus === UpgradeExecutionStatus.COMPLETED,
    );
    const notCompleted = allWorkers.filter(
      (w) => w.upgradeExecutionStatus === UpgradeExecutionStatus.IN_PROGRESS
        || w.upgradeExecutionStatus === UpgradeExecutionStatus.FAILED,
    );
    const notStaged = allWorkers.filter(
      (w) => w.upgradeExecutionStatus === UpgradeExecutionStatus.IDLE,
    );
    const failedCount = allWorkers.filter(
      (w) => w.upgradeExecutionStatus === UpgradeExecutionStatus.FAILED,
    ).length;
    const inProgressCount = allWorkers.filter(
      (w) => w.upgradeExecutionStatus === UpgradeExecutionStatus.IN_PROGRESS,
    ).length;
    const notStartedCount = allWorkers.filter(
      (w) => w.upgradeExecutionStatus === UpgradeExecutionStatus.IDLE,
    ).length;

    const allDone = inProgressCount === 0 && executionWorkers.length > 0;
    const upgradeCompleted = allDone || windowElapsed;

    let upgradeStatus: 'success' | 'failure' | 'in_progress';
    if (!upgradeCompleted) {
      upgradeStatus = 'in_progress';
    } else if (failedCount === 0 && notStartedCount === 0 && completed.length === allWorkers.length) {
      upgradeStatus = 'success';
    } else {
      upgradeStatus = 'failure';
    }

    return {
      workflowId,
      workflowStatus: workflowData.status,
      upgradeCompleted,
      upgradeStatus,
      summary: {
        total: allWorkers.length,
        completed: completed.length,
        inProgress: inProgressCount,
        failed: failedCount,
        notStarted: notStartedCount,
      },
      completed: completed.map(toDto),
      notCompleted: notCompleted.map(toDto),
      notStaged: notStaged.map(toDto),
    };
  }

  /** Worker ACK after upgrade execution. Only marks COMPLETED if ACK version matches staged version. */
  async acknowledgeExecution(
    dto: ExecutionAckDto,
  ): Promise<{ acknowledged: boolean; message?: string }> {
    this.logger.log(
      `Worker ${dto.workerId} execution ack: upgraded to ${dto.version}`,
    );

    const worker = await this.workerRepository.findOne({ where: { workerId: dto.workerId } });

    if (!worker) {
      this.logger.warn(`Worker ${dto.workerId} not found in DB`);
      return { acknowledged: false, message: 'Worker not found' };
    }

    if (worker.stagedVersion && worker.stagedVersion !== dto.version) {
      this.logger.warn(
        `Worker ${dto.workerId} ACK version mismatch: ack=${dto.version}, staged=${worker.stagedVersion}`,
      );
      await this.workerRepository.update(dto.workerId, {
        upgradeExecutionStatus: UpgradeExecutionStatus.FAILED,
      });
      this.logger.log(`Worker ${dto.workerId}: execution=FAILED (version mismatch)`);
      return {
        acknowledged: false,
        message: `Version mismatch: worker sent ${dto.version} but staged version is ${worker.stagedVersion}`,
      };
    }

    await this.workerRepository.update(dto.workerId, {
      upgradeExecutionStatus: UpgradeExecutionStatus.COMPLETED,
      upgradeBundleStaged: UpgradeBundleStatus.IDLE,
      stagedVersion: null,
      workerVersion: dto.version,
      upgradeCompletedAt: new Date(),
    });

    this.logger.log(`Worker ${dto.workerId}: execution=COMPLETED, bundle_staged=IDLE, version=${dto.version}`);

    // Check if all workers with execution in progress are done
    const remaining = await this.workerRepository.count({
      where: { upgradeExecutionStatus: UpgradeExecutionStatus.IN_PROGRESS },
    });
    if (remaining === 0) {
      await this.upgradeBundleRepository.update(
        { version: dto.version },
        { workerUpgradeStatus: WorkerAggregateStatus.COMPLETED },
      );
      this.logger.log(`All workers upgraded for version ${dto.version}, worker_upgrade_status=COMPLETED`);
    }

    return { acknowledged: true };
  }

  // Stream the upgrade bundle for a specific version and platform.
  async streamBundle(
    version: string,
    platform: 'linux' | 'windows',
  ): Promise<StreamableFile> {
    const basePath = this.cpBundlePath(version, platform);

    this.logger.log(`Serving bundle: version=${version}, platform=${platform}, path=${basePath}`);

    try {
      await fsPromises.access(basePath);
    } catch {
      throw new NotFoundException(`Bundle directory not found: ${basePath}`);
    }

    const files = await fsPromises.readdir(basePath);
    let bundleFile: string | undefined;
    let contentType: string | undefined;

    if (platform === 'linux') {
      const tarGzName = `datamigrator-worker-linux-${version}.tar.gz`;
      if (files.includes(tarGzName)) {
        bundleFile = tarGzName;
        contentType = 'application/gzip';
      }
    } else if (platform === 'windows') {
      const zipName = `datamigrator-worker-windows-${version}.zip`;
      if (files.includes(zipName)) {
        bundleFile = zipName;
        contentType = 'application/zip';
      }
    }

    if (!bundleFile) {
      throw new NotFoundException(`Bundle not found in ${basePath}`);
    }

    const bundlePath = path.join(basePath, bundleFile);
    const stat = await fsPromises.stat(bundlePath);

    this.logger.log(`Streaming: ${bundlePath} (${stat.size} bytes)`);

    return new StreamableFile(createReadStream(bundlePath), {
      type: contentType,
      disposition: `attachment; filename="${bundleFile}"`,
      length: stat.size,
    });
  }
}
