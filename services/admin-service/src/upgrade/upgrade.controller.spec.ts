import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { UpgradeController } from './upgrade.controller';
import { UpgradeService } from './upgrade.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { UploadStatus, UpgradeStatus } from './enums/upgrade.enums';
import { UserPermissionResponse } from '../auth/user-permission-response-type';
import { Response } from 'express';

describe('UpgradeController', () => {
  let controller: UpgradeController;
  let upgradeService: jest.Mocked<UpgradeService>;

  const mockLoggerFactory = {
    create: jest.fn().mockReturnValue({
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }),
  };

  const mockUserPermissions: UserPermissionResponse = {
    user: {
      id: 'user-uuid-123',
      roles: [
        {
          role_name: 'admin',
          projects: [],
          permissions: ['upgrade:write'],
        },
      ],
    },
  };

  const mockUpgradeService = {
    getLatestUploadStatus: jest.fn(),
    initUpload: jest.fn(),
    uploadChunk: jest.fn(),
    getStatus: jest.fn(),
    processUpload: jest.fn(),
    cancelUpload: jest.fn(),
    triggerUpgrade: jest.fn(),
    skipUpgrade: jest.fn(),
    getUploadHistory: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UpgradeController],
      providers: [
        {
          provide: UpgradeService,
          useValue: mockUpgradeService,
        },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
        Reflector,
        {
          provide: 'JwtService',
          useValue: {
            sign: jest.fn(),
            verify: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(require('@netapp-cloud-datamigrate/auth-lib').JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UpgradeController>(UpgradeController);
    upgradeService = module.get(UpgradeService);

    // Clear mocks
    Object.values(mockUpgradeService).forEach((mock) => mock.mockClear());
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ═══════════════════════════════════════════════════════════════
  // GET LATEST STATUS
  // ═══════════════════════════════════════════════════════════════
  describe('getLatestStatus', () => {
    it('should return latest upload status', async () => {
      const mockStatus = {
        hasUpload: true,
        uploadStatus: UploadStatus.SUCCESS,
        upgradeStatus: UpgradeStatus.PENDING,
        showUploadUI: false,
        showUpgradeUI: true,
        isUploadInProgress: false,
      };
      mockUpgradeService.getLatestUploadStatus.mockResolvedValue(mockStatus);

      const result = await controller.getLatestStatus();

      expect(mockUpgradeService.getLatestUploadStatus).toHaveBeenCalled();
      expect(result).toEqual(mockStatus);
    });

    it('should return default state when no uploads', async () => {
      const mockStatus = {
        hasUpload: false,
        showUploadUI: true,
        showUpgradeUI: false,
        isUploadInProgress: false,
      };
      mockUpgradeService.getLatestUploadStatus.mockResolvedValue(mockStatus);

      const result = await controller.getLatestStatus();

      expect(result.hasUpload).toBe(false);
      expect(result.showUploadUI).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // INIT UPLOAD
  // ═══════════════════════════════════════════════════════════════
  describe('initUpload', () => {
    it('should initialize upload session successfully', async () => {
      const dto = { fileName: 'upgrade-v2.1.0.tar.gz', fileSize: 1024 * 1024 * 100 };
      const mockResponse = {
        uploadId: 'upload-uuid-123',
        chunkSize: 100 * 1024 * 1024,
        totalChunks: 1,
      };
      mockUpgradeService.initUpload.mockResolvedValue(mockResponse);

      const result = await controller.initUpload(dto, mockUserPermissions);

      expect(mockUpgradeService.initUpload).toHaveBeenCalledWith(
        dto,
        mockUserPermissions.user.id,
      );
      expect(result).toEqual(mockResponse);
    });

    it('should pass user ID from permissions', async () => {
      const dto = { fileName: 'upgrade-v2.1.0.tar.gz', fileSize: 1024 };
      mockUpgradeService.initUpload.mockResolvedValue({
        uploadId: 'test',
        chunkSize: 100 * 1024 * 1024,
        totalChunks: 1,
      });

      await controller.initUpload(dto, mockUserPermissions);

      expect(mockUpgradeService.initUpload).toHaveBeenCalledWith(
        dto,
        'user-uuid-123',
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // UPLOAD CHUNK
  // ═══════════════════════════════════════════════════════════════
  describe('uploadChunk', () => {
    it('should upload chunk successfully', async () => {
      const uploadId = 'upload-uuid-123';
      const chunkIndex = 0;
      const mockReq = {
        headers: { 'x-chunk-index': '0' },
      } as any;
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;
      const mockResult = {
        received: true,
        chunkIndex: 0,
        bytesReceived: 1024,
      };
      mockUpgradeService.uploadChunk.mockResolvedValue(mockResult);

      await controller.uploadChunk(uploadId, mockReq, mockRes);

      expect(mockUpgradeService.uploadChunk).toHaveBeenCalledWith(
        uploadId,
        chunkIndex,
        mockReq,
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(mockResult);
    });

    it('should parse chunk index from headers', async () => {
      const uploadId = 'upload-uuid-123';
      const mockReq = {
        headers: { 'x-chunk-index': '5' },
      } as any;
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;
      mockUpgradeService.uploadChunk.mockResolvedValue({
        received: true,
        chunkIndex: 5,
        bytesReceived: 1024,
      });

      await controller.uploadChunk(uploadId, mockReq, mockRes);

      expect(mockUpgradeService.uploadChunk).toHaveBeenCalledWith(
        uploadId,
        5,
        mockReq,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // GET STATUS
  // ═══════════════════════════════════════════════════════════════
  describe('getStatus', () => {
    it('should return upload status', async () => {
      const uploadId = 'upload-uuid-123';
      const mockStatus = {
        uploadId,
        fileName: 'upgrade-v2.1.0.tar.gz',
        fileSize: 1024 * 1024,
        totalChunks: 10,
        receivedChunks: 5,
        progress: 50,
        missingChunks: [5, 6, 7, 8, 9],
      };
      mockUpgradeService.getStatus.mockResolvedValue(mockStatus);

      const result = await controller.getStatus(uploadId);

      expect(mockUpgradeService.getStatus).toHaveBeenCalledWith(uploadId);
      expect(result).toEqual(mockStatus);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // PROCESS UPLOAD
  // ═══════════════════════════════════════════════════════════════
  describe('processUpload', () => {
    it('should process upload successfully', async () => {
      const uploadId = 'upload-uuid-123';
      const mockResult = {
        success: true,
        path: '/upload/v2.1.0',
        fileSize: 1024 * 1024 * 100,
        version: 'v2.1.0',
        message: 'Upload complete',
      };
      mockUpgradeService.processUpload.mockResolvedValue(mockResult);

      const result = await controller.processUpload(uploadId);

      expect(mockUpgradeService.processUpload).toHaveBeenCalledWith(uploadId);
      expect(result).toEqual(mockResult);
    });

    it('should handle validation failure', async () => {
      const uploadId = 'upload-uuid-123';
      const mockResult = {
        success: false,
        path: '/upload/temp/upgrade.tar.gz',
        errors: ['Missing file: docker/image.tar'],
        message: 'Checksum validation failed',
      };
      mockUpgradeService.processUpload.mockResolvedValue(mockResult);

      const result = await controller.processUpload(uploadId);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // CANCEL UPLOAD
  // ═══════════════════════════════════════════════════════════════
  describe('cancelUpload', () => {
    it('should cancel upload successfully', async () => {
      const uploadId = 'upload-uuid-123';
      const mockResult = { cancelled: true, uploadId };
      mockUpgradeService.cancelUpload.mockResolvedValue(mockResult);

      const result = await controller.cancelUpload(uploadId);

      expect(mockUpgradeService.cancelUpload).toHaveBeenCalledWith(uploadId);
      expect(result).toEqual(mockResult);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // TRIGGER UPGRADE
  // Uses bundleId (primary key) instead of filePath
  // ═══════════════════════════════════════════════════════════════
  describe('triggerUpgrade', () => {
    it('should trigger upgrade successfully', async () => {
      const body = { bundleId: 'bundle-uuid-123' };
      const mockResult = {
        success: true,
        message: 'Upgrade initiated',
        bundleId: body.bundleId,
        version: 'v2.1.0',
        fileName: 'upgrade-v2.1.0.tar.gz',
      };
      mockUpgradeService.triggerUpgrade.mockResolvedValue(mockResult);

      const result = await controller.triggerUpgrade(body, mockUserPermissions);

      expect(mockUpgradeService.triggerUpgrade).toHaveBeenCalledWith(
        body.bundleId,
        mockUserPermissions.user.id,
      );
      expect(result).toEqual(mockResult);
    });

    it('should pass user ID for audit', async () => {
      const body = { bundleId: 'bundle-uuid-456' };
      mockUpgradeService.triggerUpgrade.mockResolvedValue({
        success: true,
        message: 'Upgrade initiated',
        bundleId: body.bundleId,
        version: 'v2.0.0',
      });

      await controller.triggerUpgrade(body, mockUserPermissions);

      expect(mockUpgradeService.triggerUpgrade).toHaveBeenCalledWith(
        body.bundleId,
        'user-uuid-123',
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // SKIP UPGRADE
  // Called when user resets after successful upload
  // ═══════════════════════════════════════════════════════════════
  describe('skipUpgrade', () => {
    it('should skip upgrade successfully', async () => {
      const body = { bundleId: 'bundle-uuid-123' };
      const mockResult = {
        success: true,
        message: 'Upgrade skipped successfully',
        bundleId: body.bundleId,
      };
      mockUpgradeService.skipUpgrade.mockResolvedValue(mockResult);

      const result = await controller.skipUpgrade(body);

      expect(mockUpgradeService.skipUpgrade).toHaveBeenCalledWith(body.bundleId);
      expect(result).toEqual(mockResult);
    });

    it('should return error when bundle not in valid state', async () => {
      const body = { bundleId: 'bundle-uuid-456' };
      const mockResult = {
        success: false,
        message: 'Cannot skip upgrade with status: in_progress',
      };
      mockUpgradeService.skipUpgrade.mockResolvedValue(mockResult);

      const result = await controller.skipUpgrade(body);

      expect(result.success).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // ERROR HANDLING
  // ═══════════════════════════════════════════════════════════════
  describe('error handling', () => {
    it('should propagate service errors from initUpload', async () => {
      const dto = { fileName: 'invalid.zip', fileSize: 1024 };
      const error = new Error('Invalid file type');
      mockUpgradeService.initUpload.mockRejectedValue(error);

      await expect(controller.initUpload(dto, mockUserPermissions)).rejects.toThrow(
        'Invalid file type',
      );
    });

    it('should propagate service errors from processUpload', async () => {
      const error = new Error('Session not found');
      mockUpgradeService.processUpload.mockRejectedValue(error);

      await expect(controller.processUpload('invalid-id')).rejects.toThrow(
        'Session not found',
      );
    });

    it('should propagate service errors from triggerUpgrade', async () => {
      const body = { bundleId: 'invalid-bundle-id' };
      const error = new Error('Bundle not found');
      mockUpgradeService.triggerUpgrade.mockRejectedValue(error);

      await expect(
        controller.triggerUpgrade(body, mockUserPermissions),
      ).rejects.toThrow('Bundle not found');
    });

    it('should propagate service errors from skipUpgrade', async () => {
      const body = { bundleId: '' };
      const error = new Error('Bundle ID is required');
      mockUpgradeService.skipUpgrade.mockRejectedValue(error);

      await expect(controller.skipUpgrade(body)).rejects.toThrow(
        'Bundle ID is required',
      );
    });

    it('should propagate service errors from getLatestStatus', async () => {
      const error = new Error('Database error');
      mockUpgradeService.getLatestUploadStatus.mockRejectedValue(error);

      await expect(controller.getLatestStatus()).rejects.toThrow('Database error');
    });

    it('should propagate service errors from getStatus', async () => {
      const error = new Error('Session not found');
      mockUpgradeService.getStatus.mockRejectedValue(error);

      await expect(controller.getStatus('invalid-id')).rejects.toThrow(
        'Session not found',
      );
    });

    it('should propagate service errors from cancelUpload', async () => {
      const error = new Error('Cleanup failed');
      mockUpgradeService.cancelUpload.mockRejectedValue(error);

      await expect(controller.cancelUpload('some-id')).rejects.toThrow(
        'Cleanup failed',
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // UPLOAD CHUNK HEADER VALIDATION
  // ═══════════════════════════════════════════════════════════════
  describe('uploadChunk header validation', () => {
    it('should throw BadRequestException for missing X-Chunk-Index header', async () => {
      const uploadId = 'upload-uuid-123';
      const mockReq = {
        headers: {},
      } as any;
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as any;

      await expect(controller.uploadChunk(uploadId, mockReq, mockRes)).rejects.toThrow(
        'Missing X-Chunk-Index header',
      );
    });

    it('should throw BadRequestException for empty X-Chunk-Index header', async () => {
      const uploadId = 'upload-uuid-123';
      const mockReq = {
        headers: { 'x-chunk-index': '' },
      } as any;
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as any;

      await expect(controller.uploadChunk(uploadId, mockReq, mockRes)).rejects.toThrow(
        'Missing X-Chunk-Index header',
      );
    });

    it('should throw BadRequestException for invalid X-Chunk-Index header', async () => {
      const uploadId = 'upload-uuid-123';
      const mockReq = {
        headers: { 'x-chunk-index': 'abc' },
      } as any;
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as any;

      await expect(controller.uploadChunk(uploadId, mockReq, mockRes)).rejects.toThrow(
        'Invalid X-Chunk-Index header',
      );
    });

    it('should throw BadRequestException for negative X-Chunk-Index header', async () => {
      const uploadId = 'upload-uuid-123';
      const mockReq = {
        headers: { 'x-chunk-index': '-1' },
      } as any;
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as any;

      await expect(controller.uploadChunk(uploadId, mockReq, mockRes)).rejects.toThrow(
        'Invalid X-Chunk-Index header',
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // HANDLING NULL USER PERMISSIONS
  // ═══════════════════════════════════════════════════════════════
  describe('null user permissions handling', () => {
    it('should handle null user in permissions for initUpload', async () => {
      const dto = { fileName: 'upgrade-v2.1.0.tar.gz', fileSize: 1024 };
      const mockResponse = {
        uploadId: 'test',
        chunkSize: 15 * 1024 * 1024,
        totalChunks: 1,
      };
      mockUpgradeService.initUpload.mockResolvedValue(mockResponse);

      const nullUserPermissions = { user: null } as any;
      await controller.initUpload(dto, nullUserPermissions);

      expect(mockUpgradeService.initUpload).toHaveBeenCalledWith(dto, undefined);
    });

    it('should handle null user in permissions for triggerUpgrade', async () => {
      const body = { bundleId: 'bundle-uuid-123' };
      mockUpgradeService.triggerUpgrade.mockResolvedValue({
        success: true,
        message: 'Upgrade initiated',
        bundleId: body.bundleId,
        version: 'v2.0.0',
      });

      const nullUserPermissions = { user: null } as any;
      await controller.triggerUpgrade(body, nullUserPermissions);

      expect(mockUpgradeService.triggerUpgrade).toHaveBeenCalledWith(
        body.bundleId,
        undefined,
      );
    });
  });
});
