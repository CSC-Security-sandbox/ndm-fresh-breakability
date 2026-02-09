import {
    Injectable,
    Inject,
    BadRequestException,
    NotFoundException,
    InternalServerErrorException,
  } from '@nestjs/common';
  import { ConfigService } from '@nestjs/config';
  import {
    LoggerFactory,
    LoggerService,
  } from '@netapp-cloud-datamigrate/logger-lib';
  import { Request } from 'express';
  import * as fs from 'fs';
  import * as path from 'path';
  import * as crypto from 'crypto';
  import { v4 as uuidv4 } from 'uuid';
  import { InitUploadDto, InitUploadResponseDto } from './dto/init-upload.dto';
  import { UploadChunkResponseDto } from './dto/upload-chunk.dto';
  
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
    receivedChunks: Set<number>;  // Track which chunks we've received
    tempDir: string;              // Where chunks are stored
    createdAt: Date;
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
    ) {
      this.logger = loggerFactory.create(UpgradeService.name);
      // Get base path from environment variable (set in Helm values)
      this.basePath = this.configService.get<string>('UPGRADE_BUNDLES_PATH') || '/upgrade-bundles';
      
      // Ensure base directories exist
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
  
    // ═══════════════════════════════════════════════════════════════════════════
    // INIT: Create upload session and temp directory
    // ═══════════════════════════════════════════════════════════════════════════
    async initUpload(dto: InitUploadDto): Promise<InitUploadResponseDto> {
      const uploadId = uuidv4();
      const totalChunks = Math.ceil(dto.fileSize / this.chunkSize);
      const tempDir = path.join(this.basePath, 'temp', uploadId);
  
      // Create temp directory for this upload's chunks
      fs.mkdirSync(tempDir, { recursive: true });
  
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
      };
  
      this.sessions.set(uploadId, session);
  
      this.logger.log(`Upload session initialized: ${uploadId}, expecting ${totalChunks} chunks`);
  
      return {
        uploadId,
        chunkSize: this.chunkSize,
        totalChunks,
      };
    }
  
    // ═══════════════════════════════════════════════════════════════════════════
    // CHUNK: Stream incoming chunk directly to disk (NOT to memory!)
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
  
      // Path for this chunk file
      const chunkPath = path.join(session.tempDir, `chunk_${String(chunkIndex).padStart(5, '0')}`);
  
      return new Promise((resolve, reject) => {
        // Create a write stream to disk
        const writeStream = fs.createWriteStream(chunkPath);
        let bytesReceived = 0;
  
        // ═══════════════════════════════════════════════════════════════
        // KEY INSIGHT: We pipe the request directly to the file
        // This means the chunk data NEVER sits entirely in memory!
        // ═══════════════════════════════════════════════════════════════
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
    // FINALIZE: Assemble all chunks into final file and verify checksum
    // ═══════════════════════════════════════════════════════════════════════════
    async finalizeUpload(uploadId: string) {
      const session = this.sessions.get(uploadId);
      if (!session) {
        throw new NotFoundException(`Upload session not found: ${uploadId}`);
      }
  
      // Verify all chunks received
      if (session.receivedChunks.size !== session.totalChunks) {
        const missing = this.getMissingChunks(session);
        throw new BadRequestException(
          `Missing chunks: ${missing.join(', ')}. Received ${session.receivedChunks.size}/${session.totalChunks}`,
        );
      }
  
      const finalPath = path.join(this.basePath, session.fileName);
  
      this.logger.log(`Assembling ${session.totalChunks} chunks into ${finalPath}`);
  
      // Concatenate all chunks in order
      const writeStream = fs.createWriteStream(finalPath);
      const hash = crypto.createHash('sha256');
  
      for (let i = 0; i < session.totalChunks; i++) {
        const chunkPath = path.join(session.tempDir, `chunk_${String(i).padStart(5, '0')}`);
        const chunkData = fs.readFileSync(chunkPath);
        
        writeStream.write(chunkData);
        hash.update(chunkData);
      }
  
      writeStream.end();
  
      // Wait for write to complete
      await new Promise<void>((resolve) => writeStream.on('finish', resolve));
  
      // Verify checksum
      const calculatedChecksum = hash.digest('hex');
      if (calculatedChecksum !== session.checksum) {
        // Checksum mismatch - delete the corrupted file
        fs.unlinkSync(finalPath);
        throw new BadRequestException(
          `Checksum mismatch! Expected: ${session.checksum}, Got: ${calculatedChecksum}`,
        );
      }
  
      // Cleanup temp directory
      this.cleanupTempDir(session.tempDir);
      this.sessions.delete(uploadId);
  
      this.logger.log(`Upload finalized successfully: ${finalPath}`);
  
      return {
        success: true,
        path: finalPath,
        checksum: calculatedChecksum,
        fileSize: session.fileSize,
      };
    }
  
    // ═══════════════════════════════════════════════════════════════════════════
    // CANCEL: Cleanup and abort upload
    // ═══════════════════════════════════════════════════════════════════════════
    async cancelUpload(uploadId: string) {
      const session = this.sessions.get(uploadId);
      if (!session) {
        throw new NotFoundException(`Upload session not found: ${uploadId}`);
      }
  
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

    async triggerUpgrade(filePath: string, fileName?: string) {
        // Verify file exists
        if (!fs.existsSync(filePath)) {
          throw new NotFoundException(`Upgrade bundle not found at: ${filePath}`);
        }
      
        this.logger.log(`Triggering upgrade with bundle: ${filePath}`);
      
        // TODO: Add your upgrade logic here
        // This could be:
        // - Calling a shell script
        // - Triggering a Kubernetes job
        // - Sending message to another service
        // For now, just return success
      
        return {
          success: true,
          message: 'Upgrade initiated',
          filePath,
          fileName,
        };
      }
  }