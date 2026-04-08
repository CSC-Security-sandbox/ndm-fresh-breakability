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
import { AsupTransmissionState, BundleStatus, UserDetails } from 'src/constants/types';
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
    sendSupportBundleToAsup: jest.fn(),
    getAsupTransmissionStatus: jest.fn(),
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

  describe('sendSupportBundle', () => {
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

    it('should return success message immediately without waiting for transmission to complete', async () => {
      let resolvePost: () => void;
      const pendingPost = new Promise<void>((resolve) => {
        resolvePost = resolve;
      });
      mockSupportBundleService.sendSupportBundleToAsup.mockReturnValue(
        pendingPost,
      );

      const result = await controller.sendSupportBundle(mockUserDetails);

      expect(result).toEqual({
        success: true,
        message: 'Support bundle transmission initiated',
      });
      expect(service.sendSupportBundleToAsup).toHaveBeenCalledWith(
        `ndm_logs_${mockUserDetails.user.id}.zip`,
      );

      resolvePost!();
    });

    it('should not throw if sendSupportBundleToAsup rejects — errors are swallowed via .catch()', async () => {
      mockSupportBundleService.sendSupportBundleToAsup.mockRejectedValue(
        new Error('ASUP transmission failed'),
      );

      await expect(
        controller.sendSupportBundle(mockUserDetails),
      ).resolves.toEqual({
        success: true,
        message: 'Support bundle transmission initiated',
      });
    });

    it('should derive fileName from userId', async () => {
      const otherUser: UserDetails = {
        traceId: 'trace-xyz',
        user: { id: 'other-user', roles: [] },
      };
      mockSupportBundleService.sendSupportBundleToAsup.mockResolvedValue(
        undefined,
      );

      await controller.sendSupportBundle(otherUser);

      expect(service.sendSupportBundleToAsup).toHaveBeenCalledWith(
        'ndm_logs_other-user.zip',
      );
    });
  });

  describe('getAsupStatus', () => {
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

    it('should return null when no transmission has been initiated', () => {
      mockSupportBundleService.getAsupTransmissionStatus.mockReturnValue(null);

      const result = controller.getAsupStatus(mockUserDetails);

      expect(service.getAsupTransmissionStatus).toHaveBeenCalledWith(
        `ndm_logs_${mockUserDetails.user.id}.zip`,
      );
      expect(result).toBeNull();
    });

    it('should return transmitting state while ASUP upload is in progress', () => {
      const transmittingState: AsupTransmissionState = {
        status: 'transmitting',
        startedAt: new Date('2024-01-01T10:00:00Z'),
      };
      mockSupportBundleService.getAsupTransmissionStatus.mockReturnValue(
        transmittingState,
      );

      const result = controller.getAsupStatus(mockUserDetails);

      expect(result).toEqual(transmittingState);
    });

    it('should return completed state after successful ASUP transmission', () => {
      const completedState: AsupTransmissionState = {
        status: 'completed',
        startedAt: new Date('2024-01-01T10:00:00Z'),
        completedAt: new Date('2024-01-01T10:05:00Z'),
      };
      mockSupportBundleService.getAsupTransmissionStatus.mockReturnValue(
        completedState,
      );

      const result = controller.getAsupStatus(mockUserDetails);

      expect(result).toEqual(completedState);
    });

    it('should return failed state with error message on ASUP transmission failure', () => {
      const failedState: AsupTransmissionState = {
        status: 'failed',
        startedAt: new Date('2024-01-01T10:00:00Z'),
        completedAt: new Date('2024-01-01T10:01:00Z'),
        error: 'Connection refused',
      };
      mockSupportBundleService.getAsupTransmissionStatus.mockReturnValue(
        failedState,
      );

      const result = controller.getAsupStatus(mockUserDetails);

      expect(result).toEqual(failedState);
      expect(result?.error).toBe('Connection refused');
    });

    it('should derive the fileName from the requesting userId', () => {
      const otherUser: UserDetails = {
        traceId: 'trace-xyz',
        user: { id: 'another-user', roles: [] },
      };
      mockSupportBundleService.getAsupTransmissionStatus.mockReturnValue(null);

      controller.getAsupStatus(otherUser);

      expect(service.getAsupTransmissionStatus).toHaveBeenCalledWith(
        'ndm_logs_another-user.zip',
      );
    });
  });
});
