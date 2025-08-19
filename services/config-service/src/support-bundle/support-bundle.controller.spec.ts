import { Test, TestingModule } from '@nestjs/testing';
import { SupportBundleController } from './support-bundle.controller';
import { SupportBundleService } from './support-bundle.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { JwtService } from '@netapp-cloud-datamigrate/auth-lib';
import {
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { CreateSupportBundleDTO } from './dto/create-support-bundle.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { BundleStatus, UserDetails } from 'src/constants/types';
import { SupportBundleStatus } from 'src/constants/enums';
import { Response } from 'express';

describe('SupportBundleController', () => {
  let controller: SupportBundleController;
  let service: SupportBundleService;

  const mockLoggerFactory = {
    create: jest.fn().mockReturnValue({
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    }),
  };

  const mockSupportBundleService = {
    create: jest.fn(),
    updateSupportBundleStatus: jest.fn(),
    getProjects: jest.fn(),
    isBundleReady: jest.fn(),
    downloadSupportBundle: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SupportBundleController],
      providers: [
        { provide: SupportBundleService, useValue: mockSupportBundleService },
        { provide: LoggerFactory, useValue: mockLoggerFactory },
        { provide: JwtService, useValue: {} },
      ],
    }).compile();

    controller = module.get<SupportBundleController>(SupportBundleController);
    service = module.get<SupportBundleService>(SupportBundleService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    const mockUserDetails: UserDetails = {
      traceId: 'trace-123',
      user: {
        id: 'user-123',
        roles: [
          {
            role_name: 'admin',
            projects: ['project-1'],
            permissions: ['read', 'write'],
          },
        ],
      },
    };

    const mockCreateSupportBundleDTO: CreateSupportBundleDTO = {
      startDate: '2023-01-01T00:00:00Z',
      endDate: '2023-01-31T23:59:59Z',
      projectWorkerMap: [
        {
          projectId: 'project-1',
          workerIds: ['worker-1', 'worker-2'],
        },
      ],
      otherMetrics: ['state data', 'inventory data'],
    };

    it('should create a support bundle successfully', async () => {
      const expectedResult = {
        id: 'bundle-123',
        traceId: 'trace-123',
        status: SupportBundleStatus.IN_PROGRESS,
        createdAt: new Date(),
      };

      mockSupportBundleService.create.mockResolvedValue(expectedResult);

      const result = await controller.create(
        mockCreateSupportBundleDTO,
        mockUserDetails,
      );

      expect(service.create).toHaveBeenCalledWith(
        mockCreateSupportBundleDTO,
        mockUserDetails,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should handle service errors when creating support bundle', async () => {
      const errorMessage = 'Failed to create support bundle';
      mockSupportBundleService.create.mockRejectedValue(
        new Error(errorMessage),
      );

      await expect(
        controller.create(mockCreateSupportBundleDTO, mockUserDetails),
      ).rejects.toThrow(errorMessage);

      expect(service.create).toHaveBeenCalledWith(
        mockCreateSupportBundleDTO,
        mockUserDetails,
      );
    });
  });

  describe('updateStatus', () => {
    const mockUpdateStatusDto: UpdateStatusDto = {
      traceId: 'trace-123',
      status: SupportBundleStatus.COMPLETED,
    };

    it('should update support bundle status successfully', async () => {
      const expectedResult = {
        success: true,
        message: 'Status updated successfully',
      };

      mockSupportBundleService.updateSupportBundleStatus.mockResolvedValue(
        expectedResult,
      );

      const result = await controller.updateStatus(mockUpdateStatusDto);

      expect(service.updateSupportBundleStatus).toHaveBeenCalledWith(
        mockUpdateStatusDto,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should handle service errors when updating status', async () => {
      const errorMessage = 'Failed to update status';
      mockSupportBundleService.updateSupportBundleStatus.mockRejectedValue(
        new Error(errorMessage),
      );

      await expect(
        controller.updateStatus(mockUpdateStatusDto),
      ).rejects.toThrow(errorMessage);

      expect(service.updateSupportBundleStatus).toHaveBeenCalledWith(
        mockUpdateStatusDto,
      );
    });
  });

  describe('isBundleReady', () => {
    const mockUserDetails: UserDetails = {
      traceId: 'trace-123',
      user: {
        id: 'user-123',
        roles: [
          {
            role_name: 'admin',
            projects: ['project-1'],
            permissions: ['read', 'write'],
          },
        ],
      },
    };

    it('should return true when user can download bundle', async () => {
      const expectedBundleStatus: BundleStatus = {
        isProcessing: false,
        isBundleReady: true,
        filters: {
          startDate: '2023-01-01',
          endDate: '2023-01-31',
          otherMetrics: [],
        },
        createdAt: new Date('2023-01-01T10:00:00Z'),
      };

      mockSupportBundleService.isBundleReady.mockResolvedValue(
        expectedBundleStatus,
      );

      const result = await controller.isBundleReady(mockUserDetails);

      expect(service.isBundleReady).toHaveBeenCalledWith('user-123');
      expect(result).toEqual(expectedBundleStatus);
    });

    it('should return false when bundle is still processing', async () => {
      const expectedBundleStatus: BundleStatus = {
        isProcessing: true,
        isBundleReady: false,
        filters: {
          startDate: '2023-01-01',
          endDate: '2023-01-31',
          otherMetrics: ['metric1'],
        },
        createdAt: new Date('2023-01-01T10:00:00Z'),
      };

      mockSupportBundleService.isBundleReady.mockResolvedValue(
        expectedBundleStatus,
      );

      const result = await controller.isBundleReady(mockUserDetails);

      expect(service.isBundleReady).toHaveBeenCalledWith('user-123');
      expect(result).toEqual(expectedBundleStatus);
    });

    it('should throw InternalServerErrorException when bundle creation failed', async () => {
      const errorMessage = 'Failed to create bundle';

      mockSupportBundleService.isBundleReady.mockRejectedValue(
        new InternalServerErrorException(errorMessage),
      );

      await expect(controller.isBundleReady(mockUserDetails)).rejects.toThrow(
        new InternalServerErrorException(errorMessage),
      );

      expect(service.isBundleReady).toHaveBeenCalledWith('user-123');
    });

    it('should handle service errors when checking download availability', async () => {
      const errorMessage = 'Failed to check download status';
      mockSupportBundleService.isBundleReady.mockRejectedValue(
        new Error(errorMessage),
      );

      await expect(controller.isBundleReady(mockUserDetails)).rejects.toThrow(
        errorMessage,
      );

      expect(service.isBundleReady).toHaveBeenCalledWith('user-123');
    });
  });

  describe('downloadSupportBundle', () => {
    const mockUserDetails: UserDetails = {
      traceId: 'trace-123',
      user: {
        id: 'user-123',
        roles: [
          {
            role_name: 'admin',
            projects: ['project-1'],
            permissions: ['read', 'write'],
          },
        ],
      },
    };

    let mockResponse: Partial<Response>;

    beforeEach(() => {
      mockResponse = {
        download: jest.fn(),
      };
    });

    it('should download support bundle successfully', async () => {
      const expectedFilePath = '/tmp/support-bundles/ndm_logs_user-123.zip';
      const expectedFileName = 'ndm_logs_user-123.zip';

      mockSupportBundleService.downloadSupportBundle.mockReturnValue(
        expectedFilePath,
      );

      // Mock successful download
      (mockResponse.download as jest.Mock).mockImplementation(
        (filePath, fileName, callback) => {
          callback(null);
        },
      );

      await controller.downloadSupportBundle(
        mockUserDetails,
        mockResponse as Response,
      );

      expect(service.downloadSupportBundle).toHaveBeenCalledWith(
        expectedFileName,
      );
      expect(mockResponse.download).toHaveBeenCalledWith(
        expectedFilePath,
        expectedFileName,
        expect.any(Function),
      );
    });

    it('should throw NotFoundException when file download fails', async () => {
      const expectedFilePath = '/tmp/support-bundles/ndm_logs_user-123.zip';
      const expectedFileName = 'ndm_logs_user-123.zip';

      mockSupportBundleService.downloadSupportBundle.mockReturnValue(
        expectedFilePath,
      );

      // Mock failed download
      const downloadError = new Error('File not found');
      (mockResponse.download as jest.Mock).mockImplementation(
        (filePath, fileName, callback) => {
          callback(downloadError);
        },
      );

      await expect(
        controller.downloadSupportBundle(
          mockUserDetails,
          mockResponse as Response,
        ),
      ).rejects.toThrow(NotFoundException);

      expect(service.downloadSupportBundle).toHaveBeenCalledWith(
        expectedFileName,
      );
      expect(mockResponse.download).toHaveBeenCalledWith(
        expectedFilePath,
        expectedFileName,
        expect.any(Function),
      );
    });

    it('should handle service errors when getting file path', async () => {
      const expectedFileName = 'ndm_logs_user-123.zip';
      const errorMessage = 'File not found in storage';

      mockSupportBundleService.downloadSupportBundle.mockImplementation(() => {
        throw new Error(errorMessage);
      });

      await expect(
        controller.downloadSupportBundle(
          mockUserDetails,
          mockResponse as Response,
        ),
      ).rejects.toThrow(errorMessage);

      expect(service.downloadSupportBundle).toHaveBeenCalledWith(
        expectedFileName,
      );
      expect(mockResponse.download).not.toHaveBeenCalled();
    });

    it('should generate correct filename with user ID', async () => {
      const userDetailsWithDifferentId: UserDetails = {
        traceId: 'trace-456',
        user: {
          id: 'different-user-id',
          roles: [],
        },
      };

      const expectedFileName = 'ndm_logs_different-user-id.zip';
      const expectedFilePath =
        '/tmp/support-bundles/ndm_logs_different-user-id.zip';

      mockSupportBundleService.downloadSupportBundle.mockReturnValue(
        expectedFilePath,
      );

      (mockResponse.download as jest.Mock).mockImplementation(
        (filePath, fileName, callback) => {
          callback(null);
        },
      );

      await controller.downloadSupportBundle(
        userDetailsWithDifferentId,
        mockResponse as Response,
      );

      expect(service.downloadSupportBundle).toHaveBeenCalledWith(
        expectedFileName,
      );
    });
  });
});
