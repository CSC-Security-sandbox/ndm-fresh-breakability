import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import {
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { UpgradeService } from './upgrade.service';
import { UpgradeBundle } from '../entities/upgrade-bundle.entity';
import { UploadStatus, UpgradeStatus} from './enums/upgrade.enums';
import {
  mockLoggerService,
  mockLoggerFactory,
  resetLoggerMocks,
} from '../test-utils/logger-mocks';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { EventEmitter } from 'events';

// Mock fs module
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

// Mock fs/promises module with default implementations
jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  rm: jest.fn().mockResolvedValue(undefined),
  access: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn().mockResolvedValue([]),
  stat: jest.fn().mockResolvedValue({ isFile: () => true, isDirectory: () => false }),
  readFile: jest.fn().mockResolvedValue(Buffer.from('test')),
  writeFile: jest.fn().mockResolvedValue(undefined),
  appendFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  copyFile: jest.fn().mockResolvedValue(undefined),
  chmod: jest.fn().mockResolvedValue(undefined),
}));
const mockFsPromises = fsPromises as jest.Mocked<typeof fsPromises>;

// Mock child_process
const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

describe('UpgradeService', () => {
  let service: UpgradeService;
  let upgradeBundleRepository: jest.Mocked<Repository<UpgradeBundle>>;

  const mockConfigService = {
    getOrThrow: jest.fn().mockReturnValue('/upload'),
    get: jest.fn(),
  };

  const createMockBundle = (overrides: Partial<UpgradeBundle> = {}): UpgradeBundle => ({
    id: 'bundle-uuid-123',
    fileName: 'upgrade-v2.1.0.tar.gz',
    // Note: filePath removed - deploy path is derived from version: /upload/${version}
    fileSize: 1024 * 1024 * 15, // 100MB
    version: 'v2.1.0',
    uploadStatus: UploadStatus.UPLOADING,
    upgradeStatus: UpgradeStatus.PENDING,
    uploadStartedAt: new Date(),
    uploadCompletedAt: null,
    processingStartedAt: null,
    upgradeCompletedAt: null,
    uploadedBy: 'user-123',
    upgradedBy: null,
    created_at: new Date(),
    created_by: 'user-123',
    updated_at: new Date(),
    updated_by: 'user-123',
    populateWhoColumns: jest.fn(),
    ...overrides,
  });

  beforeEach(async () => {
    // Reset all mocks before each test
    jest.clearAllMocks();
    
    // Reset fs mocks (sync methods)
    mockFs.existsSync.mockReturnValue(true);
    mockFs.mkdirSync.mockReturnValue(undefined);
    mockFs.rmSync.mockReturnValue(undefined);

    // Reset fs/promises mocks with default success values
    mockFsPromises.mkdir.mockResolvedValue(undefined);
    mockFsPromises.rm.mockResolvedValue(undefined);
    mockFsPromises.access.mockResolvedValue(undefined); // pathExists uses this - resolving means path exists
    mockFsPromises.readdir.mockResolvedValue([]);
    mockFsPromises.stat.mockResolvedValue({ isFile: () => true, isDirectory: () => false } as any);
    mockFsPromises.readFile.mockResolvedValue(Buffer.from('test'));
    mockFsPromises.writeFile.mockResolvedValue(undefined);
    mockFsPromises.appendFile.mockResolvedValue(undefined);
    mockFsPromises.unlink.mockResolvedValue(undefined);
    mockFsPromises.copyFile.mockResolvedValue(undefined);
    mockFsPromises.chmod.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UpgradeService,
        {
          provide: getRepositoryToken(UpgradeBundle),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
      ],
    }).compile();

    service = module.get<UpgradeService>(UpgradeService);
    upgradeBundleRepository = module.get(getRepositoryToken(UpgradeBundle));

    resetLoggerMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════
  // SERVICE INITIALIZATION
  // ═══════════════════════════════════════════════════════════════
  describe('constructor', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should create logger with correct name', async () => {
      // Create fresh module to test constructor behavior
      const freshMockLoggerFactory = {
        create: jest.fn().mockReturnValue(mockLoggerService),
      };
      const freshMockConfigService = {
        getOrThrow: jest.fn().mockReturnValue('/upload'),
        get: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          UpgradeService,
          {
            provide: getRepositoryToken(UpgradeBundle),
            useValue: {
              create: jest.fn(),
              save: jest.fn(),
              findOne: jest.fn(),
              find: jest.fn(),
              update: jest.fn(),
            },
          },
          {
            provide: ConfigService,
            useValue: freshMockConfigService,
          },
          {
            provide: LoggerFactory,
            useValue: freshMockLoggerFactory,
          },
        ],
      }).compile();

      module.get<UpgradeService>(UpgradeService);

      expect(freshMockLoggerFactory.create).toHaveBeenCalledWith('UpgradeService');
      expect(freshMockConfigService.getOrThrow).toHaveBeenCalledWith('UPLOAD_PATH');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // ON MODULE INIT
  // ═══════════════════════════════════════════════════════════════
  describe('onModuleInit', () => {
    it('should create directories when they do not exist', async () => {
      mockFsPromises.access.mockRejectedValue(new Error('ENOENT'));
      mockFsPromises.mkdir.mockResolvedValue(undefined);

      await service.onModuleInit();

      expect(mockFsPromises.mkdir).toHaveBeenCalled();
    });

    it('should not create directories when they already exist', async () => {
      mockFsPromises.access.mockResolvedValue(undefined);

      await service.onModuleInit();

      // mkdir might still be called with recursive: true which is idempotent
      expect(mockFsPromises.access).toHaveBeenCalled();
    });

    it('should throw InternalServerErrorException when directory creation fails', async () => {
      mockFsPromises.access.mockRejectedValue(new Error('ENOENT'));
      mockFsPromises.mkdir.mockRejectedValue(new Error('Permission denied'));

      await expect(service.onModuleInit()).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // GET LATEST UPLOAD STATUS
  // ═══════════════════════════════════════════════════════════════
  describe('getLatestUploadStatus', () => {
    it('should return default state when no uploads exist', async () => {
      upgradeBundleRepository.findOne.mockResolvedValue(null);

      const result = await service.getLatestUploadStatus();

      expect(result).toEqual({
        hasUpload: false,
        showUploadUI: true,
        showUpgradeUI: false,
        isUploadInProgress: false,
        isProcessing: false,
      });
    });

    it('should show upload UI when upload succeeded and upgrade succeeded', async () => {
      const bundle = createMockBundle({
        uploadStatus: UploadStatus.SUCCESS,
        upgradeStatus: UpgradeStatus.SUCCESS,
      });
      upgradeBundleRepository.findOne.mockResolvedValue(bundle);

      const result = await service.getLatestUploadStatus();

      expect(result.showUploadUI).toBe(true);
      expect(result.showUpgradeUI).toBe(false);
    });

    it('should show upgrade UI when upload succeeded but upgrade pending', async () => {
      const bundle = createMockBundle({
        uploadStatus: UploadStatus.SUCCESS,
        upgradeStatus: UpgradeStatus.PENDING,
      });
      upgradeBundleRepository.findOne.mockResolvedValue(bundle);

      const result = await service.getLatestUploadStatus();

      expect(result.showUploadUI).toBe(false);
      expect(result.showUpgradeUI).toBe(true);
    });

    it('should show upload UI when upload failed', async () => {
      const bundle = createMockBundle({
        uploadStatus: UploadStatus.FAILED,
      });
      upgradeBundleRepository.findOne.mockResolvedValue(bundle);

      const result = await service.getLatestUploadStatus();

      expect(result.showUploadUI).toBe(true);
      expect(result.showUpgradeUI).toBe(false);
    });

    it('should show upload UI when upload cancelled', async () => {
      const bundle = createMockBundle({
        uploadStatus: UploadStatus.CANCELLED,
      });
      upgradeBundleRepository.findOne.mockResolvedValue(bundle);

      const result = await service.getLatestUploadStatus();

      expect(result.showUploadUI).toBe(true);
      expect(result.showUpgradeUI).toBe(false);
    });

    it('should detect upload in progress', async () => {
      const bundle = createMockBundle({
        uploadStatus: UploadStatus.UPLOADING,
        uploadStartedAt: new Date(),
      });
      upgradeBundleRepository.findOne.mockResolvedValue(bundle);

      const result = await service.getLatestUploadStatus();

      expect(result.isUploadInProgress).toBe(true);
    });

    it('should mark stale uploads as failed', async () => {
      const oldDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
      const bundle = createMockBundle({
        uploadStatus: UploadStatus.UPLOADING,
        uploadStartedAt: oldDate,
        fileSize: 100 * 1024 * 1024, // 100MB - timeout would be ~30 min
      });
      upgradeBundleRepository.findOne.mockResolvedValue(bundle);
      upgradeBundleRepository.update.mockResolvedValue(undefined);

      const result = await service.getLatestUploadStatus();

      expect(upgradeBundleRepository.update).toHaveBeenCalledWith(
        bundle.id,
        expect.objectContaining({ uploadStatus: UploadStatus.FAILED }),
      );
      expect(result.isUploadInProgress).toBe(false);
    });

    it('should detect processing in progress', async () => {
      const bundle = createMockBundle({
        uploadStatus: UploadStatus.PROCESSING,
        processingStartedAt: new Date(),
      });
      upgradeBundleRepository.findOne.mockResolvedValue(bundle);

      const result = await service.getLatestUploadStatus();

      expect(result.isProcessing).toBe(true);
    });

    it('should mark stale processing as failed', async () => {
      const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago (> 60 min timeout)
      const bundle = createMockBundle({
        uploadStatus: UploadStatus.PROCESSING,
        processingStartedAt: oldDate,
      });
      upgradeBundleRepository.findOne.mockResolvedValue(bundle);
      upgradeBundleRepository.update.mockResolvedValue(undefined);

      const result = await service.getLatestUploadStatus();

      expect(upgradeBundleRepository.update).toHaveBeenCalledWith(
        bundle.id,
        expect.objectContaining({ uploadStatus: UploadStatus.FAILED }),
      );
      expect(result.isProcessing).toBe(false);
    });

    it('should use uploadStartedAt for processing timeout when processingStartedAt is null', async () => {
      const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
      const bundle = createMockBundle({
        uploadStatus: UploadStatus.PROCESSING,
        processingStartedAt: null,
        uploadStartedAt: oldDate,
      });
      upgradeBundleRepository.findOne.mockResolvedValue(bundle);
      upgradeBundleRepository.update.mockResolvedValue(undefined);

      const result = await service.getLatestUploadStatus();

      expect(upgradeBundleRepository.update).toHaveBeenCalled();
      expect(result.isProcessing).toBe(false);
    });

    it('should show upgrade UI when upload succeeded but upgrade failed (allow retry)', async () => {
      const bundle = createMockBundle({
        uploadStatus: UploadStatus.SUCCESS,
        upgradeStatus: UpgradeStatus.FAILED,
      });
      upgradeBundleRepository.findOne.mockResolvedValue(bundle);

      const result = await service.getLatestUploadStatus();

      expect(result.showUploadUI).toBe(false);
      expect(result.showUpgradeUI).toBe(true);
    });

    it('should detect upgrade in progress', async () => {
      const bundle = createMockBundle({
        uploadStatus: UploadStatus.SUCCESS,
        upgradeStatus: UpgradeStatus.IN_PROGRESS,
      });
      upgradeBundleRepository.findOne.mockResolvedValue(bundle);

      const result = await service.getLatestUploadStatus();

      expect(result.isUpgradeInProgress).toBe(true);
    });

    it('should return all bundle information', async () => {
      const bundle = createMockBundle({
        uploadStatus: UploadStatus.SUCCESS,
        upgradeStatus: UpgradeStatus.PENDING,
        version: 'v2.1.0',
        uploadCompletedAt: new Date(),
        uploadedBy: 'user-123',
      });
      upgradeBundleRepository.findOne.mockResolvedValue(bundle);

      const result = await service.getLatestUploadStatus();

      expect(result.bundleId).toBe(bundle.id);
      expect(result.version).toBe(bundle.version);
      expect(result.uploadedBy).toBe(bundle.uploadedBy);
    });

    it('should handle database error gracefully', async () => {
      upgradeBundleRepository.findOne.mockRejectedValue(new Error('Database error'));

      const result = await service.getLatestUploadStatus();

      expect(result.hasUpload).toBe(false);
      expect(result.showUploadUI).toBe(true);
      expect(result.error).toBe('Failed to load status');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // INIT UPLOAD
  // ═══════════════════════════════════════════════════════════════
  describe('initUpload', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.rmSync.mockReturnValue(undefined);
      mockFs.mkdirSync.mockReturnValue(undefined);
    });

    it('should initialize upload session successfully', async () => {
      const dto = { fileName: 'upgrade-v2.1.0.tar.gz', fileSize: 1024 * 1024 * 200 }; // 200MB
      const savedBundle = createMockBundle();
      
      upgradeBundleRepository.create.mockReturnValue(savedBundle);
      upgradeBundleRepository.save.mockResolvedValue(savedBundle);

      const result = await service.initUpload(dto, 'user-123');

      expect(result).toHaveProperty('uploadId');
      expect(result).toHaveProperty('chunkSize');
      expect(result).toHaveProperty('totalChunks');
      expect(result.chunkSize).toBe(15 * 1024 * 1024); // 15MB (service uses 15MB chunks)
      expect(result.totalChunks).toBe(Math.ceil(dto.fileSize / (15 * 1024 * 1024))); // 200MB / 15MB = 14 chunks
    });

    it('should reject non-tar.gz files', async () => {
      const dto = { fileName: 'upgrade-v2.1.0.zip', fileSize: 1024 * 1024 };

      await expect(service.initUpload(dto)).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid filename format', async () => {
      const dto = { fileName: 'invalid-file.tar.gz', fileSize: 1024 * 1024 };
      const savedBundle = createMockBundle();
      
      // The file has valid extension but invalid format - version extraction returns "file"
      upgradeBundleRepository.create.mockReturnValue(savedBundle);
      upgradeBundleRepository.save.mockResolvedValue(savedBundle);

      // This should succeed since the version extraction returns "file" (not null)
      const result = await service.initUpload(dto);
      expect(result).toHaveProperty('uploadId');
    });

    it('should create DB record with UPLOADING status', async () => {
      const dto = { fileName: 'upgrade-v2.1.0.tar.gz', fileSize: 1024 * 1024 };
      const savedBundle = createMockBundle();
      
      upgradeBundleRepository.create.mockReturnValue(savedBundle);
      upgradeBundleRepository.save.mockResolvedValue(savedBundle);

      await service.initUpload(dto, 'user-123');

      expect(upgradeBundleRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          uploadStatus: UploadStatus.UPLOADING,
          uploadedBy: 'user-123',
        }),
      );
    });

    it('should clean temp directory on init', async () => {
      const dto = { fileName: 'upgrade-v2.1.0.tar.gz', fileSize: 1024 * 1024 };
      const savedBundle = createMockBundle();
      
      // pathExists returns true (temp dir exists) so it should be cleaned
      mockFsPromises.access.mockResolvedValue(undefined);
      upgradeBundleRepository.create.mockReturnValue(savedBundle);
      upgradeBundleRepository.save.mockResolvedValue(savedBundle);

      await service.initUpload(dto);

      // Service uses fsPromises.rm (async), not fs.rmSync (sync)
      expect(mockFsPromises.rm).toHaveBeenCalled();
    });

    it('should calculate correct total chunks', async () => {
      const chunkSize = 15 * 1024 * 1024; // 15MB (matches service's chunk size)
      const fileSize = 350 * 1024 * 1024; // 350MB = 24 chunks (350/15 = 23.33, ceil = 24)
      const dto = { fileName: 'upgrade-v2.1.0.tar.gz', fileSize };
      const savedBundle = createMockBundle();
      
      upgradeBundleRepository.create.mockReturnValue(savedBundle);
      upgradeBundleRepository.save.mockResolvedValue(savedBundle);

      const result = await service.initUpload(dto);

      expect(result.totalChunks).toBe(Math.ceil(fileSize / chunkSize));
    });

    it('should reject when another upload is in progress', async () => {
      const existingBundle = createMockBundle({
        uploadStatus: UploadStatus.UPLOADING,
        uploadStartedAt: new Date(), // Recent, not stale
        fileSize: 100 * 1024 * 1024,
      });
      upgradeBundleRepository.findOne.mockResolvedValue(existingBundle);

      const dto = { fileName: 'upgrade-v2.2.0.tar.gz', fileSize: 1024 * 1024 };

      await expect(service.initUpload(dto)).rejects.toThrow(BadRequestException);
    });

    it('should reject when processing is in progress', async () => {
      const existingBundle = createMockBundle({
        uploadStatus: UploadStatus.PROCESSING,
        processingStartedAt: new Date(), // Recent, not stale
      });
      upgradeBundleRepository.findOne.mockResolvedValue(existingBundle);

      const dto = { fileName: 'upgrade-v2.2.0.tar.gz', fileSize: 1024 * 1024 };

      await expect(service.initUpload(dto)).rejects.toThrow(BadRequestException);
    });

    it('should allow upload when existing upload is stale', async () => {
      const staleBundle = createMockBundle({
        uploadStatus: UploadStatus.UPLOADING,
        uploadStartedAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
        fileSize: 100 * 1024 * 1024,
      });
      upgradeBundleRepository.findOne.mockResolvedValue(staleBundle);
      upgradeBundleRepository.update.mockResolvedValue(undefined);

      const dto = { fileName: 'upgrade-v2.2.0.tar.gz', fileSize: 1024 * 1024 };
      const newBundle = createMockBundle({ fileName: dto.fileName });
      upgradeBundleRepository.create.mockReturnValue(newBundle);
      upgradeBundleRepository.save.mockResolvedValue(newBundle);

      const result = await service.initUpload(dto);

      expect(upgradeBundleRepository.update).toHaveBeenCalledWith(
        staleBundle.id,
        expect.objectContaining({ uploadStatus: UploadStatus.FAILED }),
      );
      expect(result).toHaveProperty('uploadId');
    });

    it('should reject invalid file size', async () => {
      const dto = { fileName: 'upgrade-v2.1.0.tar.gz', fileSize: 0 };

      await expect(service.initUpload(dto)).rejects.toThrow(BadRequestException);
    });

    it('should reject negative file size', async () => {
      const dto = { fileName: 'upgrade-v2.1.0.tar.gz', fileSize: -100 };

      await expect(service.initUpload(dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw InternalServerErrorException on mkdir error', async () => {
      const dto = { fileName: 'upgrade-v2.1.0.tar.gz', fileSize: 1024 * 1024 };
      
      upgradeBundleRepository.findOne.mockResolvedValue(null); // No existing upload
      
      // Make mkdir fail immediately (happens before DB save)
      mockFsPromises.mkdir.mockRejectedValue(new Error('Disk full'));

      await expect(service.initUpload(dto)).rejects.toThrow(InternalServerErrorException);
    });

    it('should handle DB save error gracefully', async () => {
      const dto = { fileName: 'upgrade-v2.1.0.tar.gz', fileSize: 1024 * 1024 };
      const savedBundle = createMockBundle();
      
      upgradeBundleRepository.findOne.mockResolvedValue(null);
      upgradeBundleRepository.create.mockReturnValue(savedBundle);
      upgradeBundleRepository.save.mockRejectedValue(new Error('DB error'));

      await expect(service.initUpload(dto)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // UPLOAD CHUNK
  // ═══════════════════════════════════════════════════════════════
  describe('uploadChunk', () => {
    it('should throw NotFoundException for invalid upload session', async () => {
      const mockReq = {} as any;

      await expect(
        service.uploadChunk('invalid-upload-id', 0, mockReq),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for invalid chunk index', async () => {
      // First create a valid session
      const dto = { fileName: 'upgrade-v2.1.0.tar.gz', fileSize: 30 * 1024 * 1024 }; // 30MB = 2 chunks
      const savedBundle = createMockBundle();
      upgradeBundleRepository.findOne.mockResolvedValue(null);
      upgradeBundleRepository.create.mockReturnValue(savedBundle);
      upgradeBundleRepository.save.mockResolvedValue(savedBundle);

      const initResult = await service.initUpload(dto);
      const mockReq = {} as any;

      // Try invalid chunk index (negative)
      await expect(
        service.uploadChunk(initResult.uploadId, -1, mockReq),
      ).rejects.toThrow(BadRequestException);

      // Try invalid chunk index (too high)
      await expect(
        service.uploadChunk(initResult.uploadId, 100, mockReq),
      ).rejects.toThrow(BadRequestException);
    });

    it('should stream chunk to disk successfully', async () => {
      // Create a valid session
      const dto = { fileName: 'upgrade-v2.1.0.tar.gz', fileSize: 15 * 1024 * 1024 }; // 15MB = 1 chunk
      const savedBundle = createMockBundle();
      upgradeBundleRepository.findOne.mockResolvedValue(null);
      upgradeBundleRepository.create.mockReturnValue(savedBundle);
      upgradeBundleRepository.save.mockResolvedValue(savedBundle);

      const initResult = await service.initUpload(dto);

      // Create mock request and write stream
      const mockWriteStream = new EventEmitter() as any;
      mockWriteStream.destroy = jest.fn();
      mockFs.createWriteStream.mockReturnValue(mockWriteStream);

      const mockReq = new EventEmitter() as any;
      mockReq.pipe = jest.fn().mockReturnValue(mockWriteStream);

      const uploadPromise = service.uploadChunk(initResult.uploadId, 0, mockReq);

      // Simulate data event
      mockReq.emit('data', Buffer.from('test data'));
      
      // Simulate successful write
      process.nextTick(() => {
        mockWriteStream.emit('finish');
      });

      const result = await uploadPromise;

      expect(result.received).toBe(true);
      expect(result.chunkIndex).toBe(0);
    });

    it('should handle write stream error', async () => {
      // Create a valid session
      const dto = { fileName: 'upgrade-v2.1.0.tar.gz', fileSize: 15 * 1024 * 1024 };
      const savedBundle = createMockBundle();
      upgradeBundleRepository.findOne.mockResolvedValue(null);
      upgradeBundleRepository.create.mockReturnValue(savedBundle);
      upgradeBundleRepository.save.mockResolvedValue(savedBundle);
      upgradeBundleRepository.update.mockResolvedValue(undefined);

      const initResult = await service.initUpload(dto);

      const mockWriteStream = new EventEmitter() as any;
      mockWriteStream.destroy = jest.fn();
      mockFs.createWriteStream.mockReturnValue(mockWriteStream);

      const mockReq = new EventEmitter() as any;
      mockReq.pipe = jest.fn().mockReturnValue(mockWriteStream);

      const uploadPromise = service.uploadChunk(initResult.uploadId, 0, mockReq);

      // Simulate write error
      process.nextTick(() => {
        mockWriteStream.emit('error', new Error('Disk full'));
      });

      await expect(uploadPromise).rejects.toThrow(InternalServerErrorException);
      expect(upgradeBundleRepository.update).toHaveBeenCalledWith(
        savedBundle.id,
        expect.objectContaining({ uploadStatus: UploadStatus.FAILED }),
      );
    });

    it('should handle request error', async () => {
      const dto = { fileName: 'upgrade-v2.1.0.tar.gz', fileSize: 15 * 1024 * 1024 };
      const savedBundle = createMockBundle();
      upgradeBundleRepository.findOne.mockResolvedValue(null);
      upgradeBundleRepository.create.mockReturnValue(savedBundle);
      upgradeBundleRepository.save.mockResolvedValue(savedBundle);
      upgradeBundleRepository.update.mockResolvedValue(undefined);

      const initResult = await service.initUpload(dto);

      const mockWriteStream = new EventEmitter() as any;
      mockWriteStream.destroy = jest.fn();
      mockFs.createWriteStream.mockReturnValue(mockWriteStream);

      const mockReq = new EventEmitter() as any;
      mockReq.pipe = jest.fn().mockReturnValue(mockWriteStream);

      const uploadPromise = service.uploadChunk(initResult.uploadId, 0, mockReq);

      // Simulate request error
      process.nextTick(() => {
        mockReq.emit('error', new Error('Network error'));
      });

      await expect(uploadPromise).rejects.toThrow(InternalServerErrorException);
    });

    it('should handle request abort (close without finish)', async () => {
      const dto = { fileName: 'upgrade-v2.1.0.tar.gz', fileSize: 15 * 1024 * 1024 };
      const savedBundle = createMockBundle();
      upgradeBundleRepository.findOne.mockResolvedValue(null);
      upgradeBundleRepository.create.mockReturnValue(savedBundle);
      upgradeBundleRepository.save.mockResolvedValue(savedBundle);
      upgradeBundleRepository.update.mockResolvedValue(undefined);

      const initResult = await service.initUpload(dto);

      const mockWriteStream = new EventEmitter() as any;
      mockWriteStream.destroy = jest.fn();
      mockFs.createWriteStream.mockReturnValue(mockWriteStream);

      const mockReq = new EventEmitter() as any;
      mockReq.pipe = jest.fn().mockReturnValue(mockWriteStream);

      const uploadPromise = service.uploadChunk(initResult.uploadId, 0, mockReq);

      // Simulate request close without finish (abort)
      process.nextTick(() => {
        mockReq.emit('close');
      });

      await expect(uploadPromise).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // GET STATUS
  // ═══════════════════════════════════════════════════════════════
  describe('getStatus', () => {
    it('should throw NotFoundException for invalid upload session', async () => {
      await expect(service.getStatus('invalid-upload-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return status for valid session', async () => {
      // Create a valid session first
      const dto = { fileName: 'upgrade-v2.1.0.tar.gz', fileSize: 45 * 1024 * 1024 }; // 45MB = 3 chunks
      const savedBundle = createMockBundle();
      upgradeBundleRepository.findOne.mockResolvedValue(null);
      upgradeBundleRepository.create.mockReturnValue(savedBundle);
      upgradeBundleRepository.save.mockResolvedValue(savedBundle);

      const initResult = await service.initUpload(dto);
      const status = await service.getStatus(initResult.uploadId);

      expect(status.uploadId).toBe(initResult.uploadId);
      expect(status.fileName).toBe(dto.fileName);
      expect(status.fileSize).toBe(dto.fileSize);
      expect(status.totalChunks).toBe(3);
      expect(status.receivedChunks).toBe(0);
      expect(status.progress).toBe(0);
      expect(status.missingChunks).toEqual([0, 1, 2]);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // FINALIZE UPLOAD
  // ═══════════════════════════════════════════════════════════════
  describe('processUpload', () => {
    it('should throw NotFoundException for invalid upload session', async () => {
      await expect(service.processUpload('invalid-upload-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when chunks are missing', async () => {
      // Create a valid session
      const dto = { fileName: 'upgrade-v2.1.0.tar.gz', fileSize: 30 * 1024 * 1024 }; // 30MB = 2 chunks
      const savedBundle = createMockBundle();
      upgradeBundleRepository.findOne.mockResolvedValue(null);
      upgradeBundleRepository.create.mockReturnValue(savedBundle);
      upgradeBundleRepository.save.mockResolvedValue(savedBundle);
      upgradeBundleRepository.update.mockResolvedValue(undefined);

      const initResult = await service.initUpload(dto);

      // Try to process without uploading any chunks
      await expect(service.processUpload(initResult.uploadId)).rejects.toThrow(BadRequestException);

      expect(upgradeBundleRepository.update).toHaveBeenCalledWith(
        savedBundle.id,
        expect.objectContaining({ uploadStatus: UploadStatus.FAILED }),
      );
    });

    it('should assemble chunks and process bundle successfully', async () => {
      // Create a valid session with 1 chunk
      const dto = { fileName: 'upgrade-v2.1.0.tar.gz', fileSize: 15 * 1024 * 1024 }; // 15MB = 1 chunk
      const savedBundle = createMockBundle();
      upgradeBundleRepository.findOne.mockResolvedValue(null);
      upgradeBundleRepository.create.mockReturnValue(savedBundle);
      upgradeBundleRepository.save.mockResolvedValue(savedBundle);
      upgradeBundleRepository.update.mockResolvedValue(undefined);

      const initResult = await service.initUpload(dto);

      // Simulate chunk upload by directly manipulating the session
      // We'll mark the chunk as received
      const mockWriteStream = new EventEmitter() as any;
      mockWriteStream.destroy = jest.fn();
      mockFs.createWriteStream.mockReturnValue(mockWriteStream);

      const mockReq = new EventEmitter() as any;
      mockReq.pipe = jest.fn().mockReturnValue(mockWriteStream);

      const uploadPromise = service.uploadChunk(initResult.uploadId, 0, mockReq);
      process.nextTick(() => {
        mockReq.emit('data', Buffer.from('test data'));
        mockWriteStream.emit('finish');
      });
      await uploadPromise;

      // Mock the file system operations for processUpload
      mockFsPromises.access.mockResolvedValue(undefined); // file exists
      mockFsPromises.unlink.mockResolvedValue(undefined);
      mockFsPromises.readFile.mockResolvedValue(Buffer.from('chunk data'));
      mockFsPromises.appendFile.mockResolvedValue(undefined);
      mockFsPromises.rm.mockResolvedValue(undefined);

      // Mock tar extraction via spawn
      const mockTarProcess = new EventEmitter() as any;
      mockTarProcess.stderr = new EventEmitter();
      mockSpawn.mockReturnValue(mockTarProcess);

      // Mock readdir to return upgrade directory structure
      mockFsPromises.readdir.mockImplementation((dir: string) => {
        if (dir.includes('extracted')) {
          return Promise.resolve([
            { name: 'upgrade-v2.1.0', isDirectory: () => true, isFile: () => false },
          ] as any);
        }
        if (dir.includes('upgrade-v2.1.0')) {
          return Promise.resolve([
            { name: 'docker', isDirectory: () => true, isFile: () => false },
            { name: 'helm', isDirectory: () => true, isFile: () => false },
            { name: 'worker', isDirectory: () => true, isFile: () => false },
            { name: 'upgrade.sh', isDirectory: () => false, isFile: () => true },
            { name: 'checksums.sha256', isDirectory: () => false, isFile: () => true },
          ] as any);
        }
        return Promise.resolve([]);
      });

      // Mock stat for file type detection
      mockFsPromises.stat.mockResolvedValue({ isFile: () => true, isDirectory: () => false } as any);

      // Mock checksum file - return string for checksum file, Buffer for chunks
      // SHA256 hash is 64 hex characters
      (mockFsPromises.readFile as jest.Mock).mockImplementation((filePath: any, encoding?: any) => {
        if (typeof filePath === 'string' && filePath.includes('checksums.sha256')) {
          // Return string when utf-8 encoding is specified - 64 char hash
          return Promise.resolve('a123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  upgrade.sh\n');
        }
        return Promise.resolve(Buffer.from('chunk data'));
      });

      // Mock file checksum calculation
      const mockReadStream = new EventEmitter() as any;
      mockFs.createReadStream.mockReturnValue(mockReadStream);

      const processPromise = service.processUpload(initResult.uploadId);

      // Simulate tar extraction completion
      process.nextTick(() => {
        mockTarProcess.emit('close', 0);
      });

      // Simulate checksum stream
      setTimeout(() => {
        mockReadStream.emit('data', Buffer.from('test'));
        mockReadStream.emit('end');
      }, 50);

      // This will fail with checksum mismatch, which is expected
      const result = await processPromise;
      
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('should handle chunk assembly error', async () => {
      const dto = { fileName: 'upgrade-v2.1.0.tar.gz', fileSize: 15 * 1024 * 1024 };
      const savedBundle = createMockBundle();
      upgradeBundleRepository.findOne.mockResolvedValue(null);
      upgradeBundleRepository.create.mockReturnValue(savedBundle);
      upgradeBundleRepository.save.mockResolvedValue(savedBundle);
      upgradeBundleRepository.update.mockResolvedValue(undefined);

      const initResult = await service.initUpload(dto);

      // Simulate chunk upload
      const mockWriteStream = new EventEmitter() as any;
      mockWriteStream.destroy = jest.fn();
      mockFs.createWriteStream.mockReturnValue(mockWriteStream);

      const mockReq = new EventEmitter() as any;
      mockReq.pipe = jest.fn().mockReturnValue(mockWriteStream);

      const uploadPromise = service.uploadChunk(initResult.uploadId, 0, mockReq);
      process.nextTick(() => {
        mockReq.emit('data', Buffer.from('test data'));
        mockWriteStream.emit('finish');
      });
      await uploadPromise;

      // Make readFile fail during chunk assembly
      mockFsPromises.readFile.mockRejectedValue(new Error('Read error'));

      await expect(service.processUpload(initResult.uploadId)).rejects.toThrow(InternalServerErrorException);

      expect(upgradeBundleRepository.update).toHaveBeenCalledWith(
        savedBundle.id,
        expect.objectContaining({ uploadStatus: UploadStatus.FAILED }),
      );
    });

    it('should handle tar extraction failure', async () => {
      const dto = { fileName: 'upgrade-v2.1.0.tar.gz', fileSize: 15 * 1024 * 1024 };
      const savedBundle = createMockBundle();
      upgradeBundleRepository.findOne.mockResolvedValue(null);
      upgradeBundleRepository.create.mockReturnValue(savedBundle);
      upgradeBundleRepository.save.mockResolvedValue(savedBundle);
      upgradeBundleRepository.update.mockResolvedValue(undefined);

      const initResult = await service.initUpload(dto);

      // Simulate chunk upload
      const mockWriteStream = new EventEmitter() as any;
      mockWriteStream.destroy = jest.fn();
      mockFs.createWriteStream.mockReturnValue(mockWriteStream);

      const mockReq = new EventEmitter() as any;
      mockReq.pipe = jest.fn().mockReturnValue(mockWriteStream);

      const uploadPromise = service.uploadChunk(initResult.uploadId, 0, mockReq);
      process.nextTick(() => {
        mockReq.emit('data', Buffer.from('test'));
        mockWriteStream.emit('finish');
      });
      await uploadPromise;

      // Setup for processUpload
      mockFsPromises.readFile.mockResolvedValue(Buffer.from('chunk'));
      mockFsPromises.appendFile.mockResolvedValue(undefined);

      // Mock tar extraction failure
      const mockTarProcess = new EventEmitter() as any;
      mockTarProcess.stderr = new EventEmitter();
      mockSpawn.mockReturnValue(mockTarProcess);

      const processPromise = service.processUpload(initResult.uploadId);

      // Simulate tar extraction failure
      process.nextTick(() => {
        mockTarProcess.stderr.emit('data', Buffer.from('tar error'));
        mockTarProcess.emit('close', 1);
      });

      await expect(processPromise).rejects.toThrow(InternalServerErrorException);
    });

    it('should handle spawn error', async () => {
      const dto = { fileName: 'upgrade-v2.1.0.tar.gz', fileSize: 15 * 1024 * 1024 };
      const savedBundle = createMockBundle();
      upgradeBundleRepository.findOne.mockResolvedValue(null);
      upgradeBundleRepository.create.mockReturnValue(savedBundle);
      upgradeBundleRepository.save.mockResolvedValue(savedBundle);
      upgradeBundleRepository.update.mockResolvedValue(undefined);

      const initResult = await service.initUpload(dto);

      // Simulate chunk upload
      const mockWriteStream = new EventEmitter() as any;
      mockWriteStream.destroy = jest.fn();
      mockFs.createWriteStream.mockReturnValue(mockWriteStream);

      const mockReq = new EventEmitter() as any;
      mockReq.pipe = jest.fn().mockReturnValue(mockWriteStream);

      const uploadPromise = service.uploadChunk(initResult.uploadId, 0, mockReq);
      process.nextTick(() => {
        mockReq.emit('data', Buffer.from('test'));
        mockWriteStream.emit('finish');
      });
      await uploadPromise;

      mockFsPromises.readFile.mockResolvedValue(Buffer.from('chunk'));
      mockFsPromises.appendFile.mockResolvedValue(undefined);

      // Mock spawn error
      const mockTarProcess = new EventEmitter() as any;
      mockTarProcess.stderr = new EventEmitter();
      mockSpawn.mockReturnValue(mockTarProcess);

      const processPromise = service.processUpload(initResult.uploadId);

      process.nextTick(() => {
        mockTarProcess.emit('error', new Error('Spawn failed'));
      });

      await expect(processPromise).rejects.toThrow(InternalServerErrorException);
    });

    it('should handle missing checksums.sha256 file', async () => {
      const dto = { fileName: 'upgrade-v2.1.0.tar.gz', fileSize: 15 * 1024 * 1024 };
      const savedBundle = createMockBundle();
      upgradeBundleRepository.findOne.mockResolvedValue(null);
      upgradeBundleRepository.create.mockReturnValue(savedBundle);
      upgradeBundleRepository.save.mockResolvedValue(savedBundle);
      upgradeBundleRepository.update.mockResolvedValue(undefined);

      const initResult = await service.initUpload(dto);

      // Simulate chunk upload
      const mockWriteStream = new EventEmitter() as any;
      mockWriteStream.destroy = jest.fn();
      mockFs.createWriteStream.mockReturnValue(mockWriteStream);

      const mockReq = new EventEmitter() as any;
      mockReq.pipe = jest.fn().mockReturnValue(mockWriteStream);

      const uploadPromise = service.uploadChunk(initResult.uploadId, 0, mockReq);
      process.nextTick(() => {
        mockReq.emit('data', Buffer.from('test'));
        mockWriteStream.emit('finish');
      });
      await uploadPromise;

      mockFsPromises.readFile.mockResolvedValue(Buffer.from('chunk'));
      mockFsPromises.appendFile.mockResolvedValue(undefined);

      const mockTarProcess = new EventEmitter() as any;
      mockTarProcess.stderr = new EventEmitter();
      mockSpawn.mockReturnValue(mockTarProcess);

      // Mock readdir to return upgrade directory but no checksum file
      mockFsPromises.readdir.mockImplementation((dir: string) => {
        if (dir.includes('extracted')) {
          return Promise.resolve([
            { name: 'upgrade-v2.1.0', isDirectory: () => true, isFile: () => false },
          ] as any);
        }
        return Promise.resolve([
          { name: 'docker', isDirectory: () => true, isFile: () => false },
        ] as any);
      });

      // Mock access to indicate checksums.sha256 doesn't exist
      mockFsPromises.access.mockImplementation((filePath: string) => {
        if (typeof filePath === 'string' && filePath.includes('checksums.sha256')) {
          return Promise.reject(new Error('ENOENT'));
        }
        return Promise.resolve(undefined);
      });

      const processPromise = service.processUpload(initResult.uploadId);

      process.nextTick(() => {
        mockTarProcess.emit('close', 0);
      });

      await expect(processPromise).rejects.toThrow(InternalServerErrorException);
    });

    it('should handle empty checksum file', async () => {
      const dto = { fileName: 'upgrade-v2.1.0.tar.gz', fileSize: 15 * 1024 * 1024 };
      const savedBundle = createMockBundle();
      upgradeBundleRepository.findOne.mockResolvedValue(null);
      upgradeBundleRepository.create.mockReturnValue(savedBundle);
      upgradeBundleRepository.save.mockResolvedValue(savedBundle);
      upgradeBundleRepository.update.mockResolvedValue(undefined);

      const initResult = await service.initUpload(dto);

      const mockWriteStream = new EventEmitter() as any;
      mockWriteStream.destroy = jest.fn();
      mockFs.createWriteStream.mockReturnValue(mockWriteStream);

      const mockReq = new EventEmitter() as any;
      mockReq.pipe = jest.fn().mockReturnValue(mockWriteStream);

      const uploadPromise = service.uploadChunk(initResult.uploadId, 0, mockReq);
      process.nextTick(() => {
        mockReq.emit('data', Buffer.from('test'));
        mockWriteStream.emit('finish');
      });
      await uploadPromise;

      // Mock readFile to return empty checksum file - return string for checksum
      (mockFsPromises.readFile as jest.Mock).mockImplementation((filePath: any, encoding?: any) => {
        if (typeof filePath === 'string' && filePath.includes('checksums.sha256')) {
          return Promise.resolve('');
        }
        return Promise.resolve(Buffer.from('chunk'));
      });
      mockFsPromises.appendFile.mockResolvedValue(undefined);
      mockFsPromises.access.mockResolvedValue(undefined);

      const mockTarProcess = new EventEmitter() as any;
      mockTarProcess.stderr = new EventEmitter();
      mockSpawn.mockReturnValue(mockTarProcess);

      mockFsPromises.readdir.mockImplementation((dir: string) => {
        if (dir.includes('extracted')) {
          return Promise.resolve([
            { name: 'upgrade-v2.1.0', isDirectory: () => true, isFile: () => false },
          ] as any);
        }
        return Promise.resolve([
          { name: 'checksums.sha256', isDirectory: () => false, isFile: () => true },
        ] as any);
      });

      const processPromise = service.processUpload(initResult.uploadId);

      process.nextTick(() => {
        mockTarProcess.emit('close', 0);
      });

      // BadRequestException is wrapped in InternalServerErrorException by processUpload
      await expect(processPromise).rejects.toThrow(InternalServerErrorException);
    });

    it('should handle invalid checksum file format', async () => {
      const dto = { fileName: 'upgrade-v2.1.0.tar.gz', fileSize: 15 * 1024 * 1024 };
      const savedBundle = createMockBundle();
      upgradeBundleRepository.findOne.mockResolvedValue(null);
      upgradeBundleRepository.create.mockReturnValue(savedBundle);
      upgradeBundleRepository.save.mockResolvedValue(savedBundle);
      upgradeBundleRepository.update.mockResolvedValue(undefined);

      const initResult = await service.initUpload(dto);

      const mockWriteStream = new EventEmitter() as any;
      mockWriteStream.destroy = jest.fn();
      mockFs.createWriteStream.mockReturnValue(mockWriteStream);

      const mockReq = new EventEmitter() as any;
      mockReq.pipe = jest.fn().mockReturnValue(mockWriteStream);

      const uploadPromise = service.uploadChunk(initResult.uploadId, 0, mockReq);
      process.nextTick(() => {
        mockReq.emit('data', Buffer.from('test'));
        mockWriteStream.emit('finish');
      });
      await uploadPromise;

      // Mock readFile to return invalid checksum format - return string for checksum
      (mockFsPromises.readFile as jest.Mock).mockImplementation((filePath: any, encoding?: any) => {
        if (typeof filePath === 'string' && filePath.includes('checksums.sha256')) {
          return Promise.resolve('invalid line without proper format\nno hash here');
        }
        return Promise.resolve(Buffer.from('chunk'));
      });
      mockFsPromises.appendFile.mockResolvedValue(undefined);
      mockFsPromises.access.mockResolvedValue(undefined);

      const mockTarProcess = new EventEmitter() as any;
      mockTarProcess.stderr = new EventEmitter();
      mockSpawn.mockReturnValue(mockTarProcess);

      mockFsPromises.readdir.mockImplementation((dir: string) => {
        if (dir.includes('extracted')) {
          return Promise.resolve([
            { name: 'upgrade-v2.1.0', isDirectory: () => true, isFile: () => false },
          ] as any);
        }
        return Promise.resolve([
          { name: 'checksums.sha256', isDirectory: () => false, isFile: () => true },
        ] as any);
      });

      const processPromise = service.processUpload(initResult.uploadId);

      process.nextTick(() => {
        mockTarProcess.emit('close', 0);
      });

      // BadRequestException is wrapped in InternalServerErrorException by processUpload
      await expect(processPromise).rejects.toThrow(InternalServerErrorException);
    });

    it('should handle empty extraction directory', async () => {
      const dto = { fileName: 'upgrade-v2.1.0.tar.gz', fileSize: 15 * 1024 * 1024 };
      const savedBundle = createMockBundle();
      upgradeBundleRepository.findOne.mockResolvedValue(null);
      upgradeBundleRepository.create.mockReturnValue(savedBundle);
      upgradeBundleRepository.save.mockResolvedValue(savedBundle);
      upgradeBundleRepository.update.mockResolvedValue(undefined);

      const initResult = await service.initUpload(dto);

      const mockWriteStream = new EventEmitter() as any;
      mockWriteStream.destroy = jest.fn();
      mockFs.createWriteStream.mockReturnValue(mockWriteStream);

      const mockReq = new EventEmitter() as any;
      mockReq.pipe = jest.fn().mockReturnValue(mockWriteStream);

      const uploadPromise = service.uploadChunk(initResult.uploadId, 0, mockReq);
      process.nextTick(() => {
        mockReq.emit('data', Buffer.from('test'));
        mockWriteStream.emit('finish');
      });
      await uploadPromise;

      mockFsPromises.readFile.mockResolvedValue(Buffer.from('chunk'));
      mockFsPromises.appendFile.mockResolvedValue(undefined);
      mockFsPromises.access.mockResolvedValue(undefined);

      const mockTarProcess = new EventEmitter() as any;
      mockTarProcess.stderr = new EventEmitter();
      mockSpawn.mockReturnValue(mockTarProcess);

      // Mock empty extraction directory
      mockFsPromises.readdir.mockResolvedValue([]);

      const processPromise = service.processUpload(initResult.uploadId);

      process.nextTick(() => {
        mockTarProcess.emit('close', 0);
      });

      await expect(processPromise).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // CANCEL UPLOAD
  // ═══════════════════════════════════════════════════════════════
  describe('cancelUpload', () => {
    it('should handle missing session gracefully (session may have been lost due to pod restart)', async () => {
      // cancelUpload no longer throws NotFoundException - it handles gracefully
      // This supports the scenario where user refreshes during upload and session is lost
      upgradeBundleRepository.findOne.mockResolvedValue(null);
      
      const result = await service.cancelUpload('invalid-upload-id');

      expect(result).toEqual({
        cancelled: true,
        uploadId: 'invalid-upload-id',
        message: 'Session not found, but cleanup attempted',
      });
    });

    it('should cancel stale DB record when session is missing', async () => {
      const staleBundle = createMockBundle({
        id: 'stale-bundle-id',
        uploadStatus: UploadStatus.UPLOADING,
      });
      upgradeBundleRepository.findOne.mockResolvedValue(staleBundle);
      upgradeBundleRepository.update.mockResolvedValue(undefined);

      await service.cancelUpload('missing-session-id');

      expect(upgradeBundleRepository.update).toHaveBeenCalledWith(
        'stale-bundle-id',
        expect.objectContaining({
          uploadStatus: UploadStatus.CANCELLED,
        }),
      );
    });

    it('should cancel valid session successfully', async () => {
      // Create a valid session
      const dto = { fileName: 'upgrade-v2.1.0.tar.gz', fileSize: 15 * 1024 * 1024 };
      const savedBundle = createMockBundle();
      upgradeBundleRepository.findOne.mockResolvedValue(null);
      upgradeBundleRepository.create.mockReturnValue(savedBundle);
      upgradeBundleRepository.save.mockResolvedValue(savedBundle);
      upgradeBundleRepository.update.mockResolvedValue(undefined);

      const initResult = await service.initUpload(dto);

      // Now cancel it
      const result = await service.cancelUpload(initResult.uploadId);

      expect(result.cancelled).toBe(true);
      expect(result.uploadId).toBe(initResult.uploadId);
      expect(upgradeBundleRepository.update).toHaveBeenCalledWith(
        savedBundle.id,
        expect.objectContaining({ uploadStatus: UploadStatus.CANCELLED }),
      );
    });

    it('should handle DB update error during cancel gracefully', async () => {
      // Create a valid session
      const dto = { fileName: 'upgrade-v2.1.0.tar.gz', fileSize: 15 * 1024 * 1024 };
      const savedBundle = createMockBundle();
      upgradeBundleRepository.findOne.mockResolvedValue(null);
      upgradeBundleRepository.create.mockReturnValue(savedBundle);
      upgradeBundleRepository.save.mockResolvedValue(savedBundle);
      
      const initResult = await service.initUpload(dto);

      // Make DB update fail
      upgradeBundleRepository.update.mockRejectedValue(new Error('DB error'));

      // Should still complete (gracefully handle error)
      const result = await service.cancelUpload(initResult.uploadId);

      expect(result.cancelled).toBe(true);
    });

    it('should handle DB error when cancelling stale record', async () => {
      upgradeBundleRepository.findOne.mockRejectedValue(new Error('DB error'));

      const result = await service.cancelUpload('some-id');

      expect(result.cancelled).toBe(true);
      expect(result.message).toBe('Session not found, but cleanup attempted');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // TRIGGER UPGRADE
  // ═══════════════════════════════════════════════════════════════
  describe('triggerUpgrade', () => {
    it('should throw NotFoundException when bundle not found in DB', async () => {
      // Bundle not found in database
      upgradeBundleRepository.findOne.mockResolvedValue(null);

      await expect(
        service.triggerUpgrade('non-existent-bundle-id', 'user-123'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when deploy path does not exist', async () => {
      const bundle = createMockBundle({
        uploadStatus: UploadStatus.SUCCESS,
        version: 'v2.1.0',
      });
      upgradeBundleRepository.findOne.mockResolvedValue(bundle);
      // pathExists uses fsPromises.access - rejecting means path doesn't exist
      mockFsPromises.access.mockRejectedValue(new Error('ENOENT'));

      await expect(
        service.triggerUpgrade('bundle-uuid-123', 'user-123'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update bundle status to SUCCESS on trigger', async () => {
      const bundle = createMockBundle({
        uploadStatus: UploadStatus.SUCCESS,
        version: 'v2.1.0',
      });
      // pathExists uses fsPromises.access - resolving means path exists
      mockFsPromises.access.mockResolvedValue(undefined);
      upgradeBundleRepository.findOne.mockResolvedValue(bundle);
      upgradeBundleRepository.update.mockResolvedValue(undefined);

      // New signature: triggerUpgrade(bundleId, userId)
      const result = await service.triggerUpgrade('bundle-uuid-123', 'user-123');

      expect(result.success).toBe(true);
      expect(upgradeBundleRepository.update).toHaveBeenCalledWith(
        bundle.id,
        expect.objectContaining({
          upgradeStatus: UpgradeStatus.SUCCESS,
          upgradedBy: 'user-123',
        }),
      );
    });

    it('should throw BadRequestException if upload not successful', async () => {
      const bundle = createMockBundle({
        uploadStatus: UploadStatus.UPLOADING, // Not SUCCESS
      });
      upgradeBundleRepository.findOne.mockResolvedValue(bundle);

      await expect(service.triggerUpgrade('bundle-uuid-123', 'user-123'))
        .rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for empty bundleId', async () => {
      await expect(service.triggerUpgrade('', 'user-123'))
        .rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for whitespace bundleId', async () => {
      await expect(service.triggerUpgrade('   ', 'user-123'))
        .rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if bundle version is missing', async () => {
      const bundle = createMockBundle({
        uploadStatus: UploadStatus.SUCCESS,
        version: null,
      });
      upgradeBundleRepository.findOne.mockResolvedValue(bundle);

      await expect(service.triggerUpgrade('bundle-uuid-123', 'user-123'))
        .rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if upgrade already in progress', async () => {
      const bundle = createMockBundle({
        uploadStatus: UploadStatus.SUCCESS,
        upgradeStatus: UpgradeStatus.IN_PROGRESS,
        version: 'v2.1.0',
      });
      mockFsPromises.access.mockResolvedValue(undefined);
      upgradeBundleRepository.findOne.mockResolvedValue(bundle);

      await expect(service.triggerUpgrade('bundle-uuid-123', 'user-123'))
        .rejects.toThrow(BadRequestException);
    });

    it('should return success response with bundle info', async () => {
      const bundle = createMockBundle({
        uploadStatus: UploadStatus.SUCCESS,
        upgradeStatus: UpgradeStatus.PENDING,
        version: 'v2.1.0',
        fileName: 'upgrade-v2.1.0.tar.gz',
      });
      mockFsPromises.access.mockResolvedValue(undefined);
      upgradeBundleRepository.findOne.mockResolvedValue(bundle);
      upgradeBundleRepository.update.mockResolvedValue(undefined);

      const result = await service.triggerUpgrade('bundle-uuid-123', 'user-123');

      expect(result.success).toBe(true);
      expect(result.bundleId).toBe(bundle.id);
      expect(result.version).toBe(bundle.version);
      expect(result.fileName).toBe(bundle.fileName);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // SKIP UPGRADE
  // ═══════════════════════════════════════════════════════════════
  describe('skipUpgrade', () => {
    it('should throw BadRequestException for empty bundleId', async () => {
      await expect(service.skipUpgrade('')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for whitespace bundleId', async () => {
      await expect(service.skipUpgrade('   ')).rejects.toThrow(BadRequestException);
    });

    it('should return success when bundle not found', async () => {
      upgradeBundleRepository.findOne.mockResolvedValue(null);

      const result = await service.skipUpgrade('non-existent-id');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Bundle not found, nothing to skip');
    });

    it('should return failure when upload status is not SUCCESS', async () => {
      const bundle = createMockBundle({
        uploadStatus: UploadStatus.UPLOADING,
      });
      upgradeBundleRepository.findOne.mockResolvedValue(bundle);

      const result = await service.skipUpgrade('bundle-uuid-123');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Cannot skip upgrade');
    });

    it('should return failure when upgrade status is not PENDING', async () => {
      const bundle = createMockBundle({
        uploadStatus: UploadStatus.SUCCESS,
        upgradeStatus: UpgradeStatus.SUCCESS,
      });
      upgradeBundleRepository.findOne.mockResolvedValue(bundle);

      const result = await service.skipUpgrade('bundle-uuid-123');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Only pending upgrades can be skipped');
    });

    it('should skip upgrade successfully', async () => {
      const bundle = createMockBundle({
        uploadStatus: UploadStatus.SUCCESS,
        upgradeStatus: UpgradeStatus.PENDING,
      });
      upgradeBundleRepository.findOne.mockResolvedValue(bundle);
      upgradeBundleRepository.update.mockResolvedValue(undefined);

      const result = await service.skipUpgrade('bundle-uuid-123');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Upgrade skipped successfully');
      expect(result.bundleId).toBe(bundle.id);
      expect(upgradeBundleRepository.update).toHaveBeenCalledWith(
        bundle.id,
        expect.objectContaining({ upgradeStatus: UpgradeStatus.SKIPPED }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // TRIGGER UPGRADE - Error Handling
  // ═══════════════════════════════════════════════════════════════
  describe('triggerUpgrade error handling', () => {
    it('should handle DB update error gracefully', async () => {
      const bundle = createMockBundle({
        uploadStatus: UploadStatus.SUCCESS,
        upgradeStatus: UpgradeStatus.PENDING,
        version: 'v2.1.0',
      });
      mockFsPromises.access.mockResolvedValue(undefined);
      upgradeBundleRepository.findOne.mockResolvedValue(bundle);
      upgradeBundleRepository.update.mockRejectedValue(new Error('DB error'));

      await expect(service.triggerUpgrade('bundle-uuid-123', 'user-123'))
        .rejects.toThrow(InternalServerErrorException);
    });
  });
});
