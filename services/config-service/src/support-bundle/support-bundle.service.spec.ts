import { Test, TestingModule } from '@nestjs/testing';
import { SupportBundleService } from './support-bundle.service';
import { NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SupportBundleEntity } from 'src/entities/support-bundle-log.entity';
import { WorkflowService } from 'src/workflow/workflow.service';
import { SupportBundleStatus, WorkFlows } from 'src/constants/enums';
import { UserDetails } from 'src/constants/types';
import { CreateSupportBundleDTO } from './dto/create-support-bundle.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Mock dependencies
jest.mock('fs');
jest.mock('path');
jest.mock('uuid', () => ({
  v4: jest.fn(),
}));
jest.mock('app-root-path', () => ({
  resolve: jest.fn(() => '/mock/root/path'),
  toString: jest.fn(() => '/mock/root/path'),
  path: '/mock/root/path',
}));

// Mock the logger lib to avoid any issues with it
jest.mock('@netapp-cloud-datamigrate/logger-lib', () => ({
  LoggerFactory: jest.fn().mockImplementation(() => ({
    create: jest.fn(),
  })),
  LoggerService: jest.fn(),
}));

import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

describe('SupportBundleService', () => {
  let service: SupportBundleService;
  let supportBundleRepo: jest.Mocked<Repository<SupportBundleEntity>>;
  let workflowService: jest.Mocked<WorkflowService>;
  let configService: jest.Mocked<ConfigService>;
  let mockLoggerFactory: any;
  let mockLogger: any;

  const mockUuid = 'test-uuid-123';
  const mockBundlePath = '/test/bundle/path';

  beforeEach(async () => {
    jest.clearAllMocks();
    (uuidv4 as jest.Mock).mockReturnValue(mockUuid);

    // Mock logger
    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };

    mockLoggerFactory = {
      create: jest.fn().mockReturnValue(mockLogger),
    };

    // Mock repositories
    const supportBundleRepoMock = {
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      findOne: jest.fn(),
    };

    // Mock workflow service
    const workflowServiceMock = {
      startWorkflow: jest.fn(),
    };

    // Mock config service
    const configServiceMock = {
      get: jest.fn().mockReturnValue(mockBundlePath),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupportBundleService,
        {
          provide: getRepositoryToken(SupportBundleEntity),
          useValue: supportBundleRepoMock,
        },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
        {
          provide: WorkflowService,
          useValue: workflowServiceMock,
        },
        {
          provide: ConfigService,
          useValue: configServiceMock,
        },
      ],
    }).compile();

    service = module.get<SupportBundleService>(SupportBundleService);
    supportBundleRepo = module.get(getRepositoryToken(SupportBundleEntity)) as jest.Mocked<Repository<SupportBundleEntity>>;
    workflowService = module.get<WorkflowService>(WorkflowService) as jest.Mocked<WorkflowService>;
    configService = module.get<ConfigService>(ConfigService) as jest.Mocked<ConfigService>;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('constructor', () => {
    it('should initialize logger and bundle output path', () => {
      expect(mockLoggerFactory.create).toHaveBeenCalledWith(SupportBundleService.name);
      expect(configService.get).toHaveBeenCalledWith('app.bundle.bundleOutputPath');
    });
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

    const mockCreateDto: CreateSupportBundleDTO = {
      startDate: '2023-01-01T00:00:00Z',
      endDate: '2023-01-31T23:59:59Z',
      otherMetrics: ['state data', 'inventory data'],
    };

    it('should create support bundle successfully', async () => {
      const mockEntity = { id: 1, requestId: mockUuid };
      supportBundleRepo.create.mockReturnValue(mockEntity as any);
      supportBundleRepo.save.mockResolvedValue(mockEntity as any);
      workflowService.startWorkflow.mockResolvedValue(undefined);

      const result = await service.create(mockCreateDto, mockUserDetails);

      expect(result).toEqual({ traceId: mockUuid });
      expect(supportBundleRepo.create).toHaveBeenCalledWith({
        requestId: mockUuid,
        userId: mockUserDetails.user.id,
        status: SupportBundleStatus.IN_PROGRESS,
        createdBy: mockUserDetails.user.id,
        workflowId: `${WorkFlows.SUPPORT_BUNDLE_WORKFLOW}-${mockUuid}`,
        filters: {
          startDate: mockCreateDto.startDate,
          endDate: mockCreateDto.endDate,
          otherMetrics: mockCreateDto.otherMetrics,
        },
      });
      expect(supportBundleRepo.save).toHaveBeenCalledWith(mockEntity);
      expect(workflowService.startWorkflow).toHaveBeenCalled();
      expect(mockLogger.log).toHaveBeenCalledWith(
        `Starting SupportBundleWorkflow with requestId: ${mockUuid} and userId: ${mockUserDetails.user.id}`,
      );
      expect(mockLogger.log).toHaveBeenCalledWith('Started SupportBundleWorkflow successfully');
    });

    it('should create support bundle with empty projectWorkerMap and otherMetrics when not provided', async () => {
      const dtoWithoutOptionalFields = {
        startDate: '2023-01-01T00:00:00Z',
        endDate: '2023-01-31T23:59:59Z',
      };
      const mockEntity = { id: 1, requestId: mockUuid };
      supportBundleRepo.create.mockReturnValue(mockEntity as any);
      supportBundleRepo.save.mockResolvedValue(mockEntity as any);
      workflowService.startWorkflow.mockResolvedValue(undefined);

      const result = await service.create(dtoWithoutOptionalFields as CreateSupportBundleDTO, mockUserDetails);

      expect(result).toEqual({ traceId: mockUuid });
      expect(supportBundleRepo.create).toHaveBeenCalledWith({
        requestId: mockUuid,
        userId: mockUserDetails.user.id,
        status: SupportBundleStatus.IN_PROGRESS,
        createdBy: mockUserDetails.user.id,
        workflowId: `${WorkFlows.SUPPORT_BUNDLE_WORKFLOW}-${mockUuid}`,
        filters: {
          startDate: dtoWithoutOptionalFields.startDate,
          endDate: dtoWithoutOptionalFields.endDate,
          otherMetrics: [],
        },
      });
    });

    it('should handle workflow start error and continue execution', async () => {
      const mockEntity = { id: 1, requestId: mockUuid };
      supportBundleRepo.create.mockReturnValue(mockEntity as any);
      supportBundleRepo.save.mockResolvedValue(mockEntity as any);
      const workflowError = new Error('Workflow failed');
      workflowService.startWorkflow.mockRejectedValue(workflowError);

      const result = await service.create(mockCreateDto, mockUserDetails);

      expect(result).toEqual({ traceId: mockUuid });
      expect(mockLogger.error).toHaveBeenCalledWith(
        `Error while starting SupportBundleWorkflow - ${workflowError.message}`,
      );
    });

    it('should call workflow service with correct payload', async () => {
      const mockEntity = { id: 1, requestId: mockUuid };
      supportBundleRepo.create.mockReturnValue(mockEntity as any);
      supportBundleRepo.save.mockResolvedValue(mockEntity as any);
      workflowService.startWorkflow.mockResolvedValue(undefined);

      await service.create(mockCreateDto, mockUserDetails);

      expect(workflowService.startWorkflow).toHaveBeenCalledWith(
        WorkFlows.SUPPORT_BUNDLE_WORKFLOW,
        expect.objectContaining({
          workflowId: `${WorkFlows.SUPPORT_BUNDLE_WORKFLOW}-${mockUuid}`,
          taskQueue: 'Support-TaskQueue',
          args: [
            {
              traceId: mockUuid,
              payload: expect.objectContaining({
                traceId: mockUuid,
                startDate: mockCreateDto.startDate,
                endDate: mockCreateDto.endDate,
                userId: mockUserDetails.user.id,
                otherMetrics: mockCreateDto.otherMetrics,
              }),
              options: expect.any(Object),
            },
          ],
        }),
      );
    });
  });

  describe('updateSupportBundleStatus', () => {
    const mockUpdateDto: UpdateStatusDto = {
      traceId: 'trace-123',
      status: SupportBundleStatus.COMPLETED,
      errorMessage: 'test error',
    };

    it('should update support bundle status successfully', async () => {
      supportBundleRepo.update.mockResolvedValue({ affected: 1 } as any);

      await service.updateSupportBundleStatus(mockUpdateDto);

      expect(supportBundleRepo.update).toHaveBeenCalledWith(
        { requestId: mockUpdateDto.traceId },
        {
          status: mockUpdateDto.status,
          errorMessage: mockUpdateDto.errorMessage,
        },
      );
    });

    it('should throw error when support bundle not found', async () => {
      supportBundleRepo.update.mockResolvedValue({ affected: 0 } as any);

      await expect(service.updateSupportBundleStatus(mockUpdateDto)).rejects.toThrow(
        `Support bundle not found for traceId: ${mockUpdateDto.traceId}`,
      );
    });

    it('should update without error message when not provided', async () => {
      const updateDtoWithoutError: UpdateStatusDto = {
        traceId: 'trace-123',
        status: SupportBundleStatus.COMPLETED,
      };
      supportBundleRepo.update.mockResolvedValue({ affected: 1 } as any);

      await service.updateSupportBundleStatus(updateDtoWithoutError);

      expect(supportBundleRepo.update).toHaveBeenCalledWith(
        { requestId: updateDtoWithoutError.traceId },
        {
          status: updateDtoWithoutError.status,
          errorMessage: undefined,
        },
      );
    });
  });

  describe('isBundleReady', () => {
    const userId = 'user-123';

    it('should return bundle ready status for completed bundle', async () => {
      const mockBundle = {
        status: SupportBundleStatus.COMPLETED,
        errorMessage: null,
      };
      supportBundleRepo.findOne.mockResolvedValue(mockBundle as any);

      const result = await service.isBundleReady(userId);

      expect(supportBundleRepo.findOne).toHaveBeenCalledWith({
        where: { userId },
        order: { createdAt: 'DESC' },
        select: ['status', 'errorMessage'],
      });
      expect(result).toEqual({
        isProcessing: false,
        isBundleReady: true,
        error: null,
      });
    });

    it('should return processing status for in-progress bundle', async () => {
      const mockBundle = {
        status: SupportBundleStatus.IN_PROGRESS,
        errorMessage: null,
      };
      supportBundleRepo.findOne.mockResolvedValue(mockBundle as any);

      const result = await service.isBundleReady(userId);

      expect(result).toEqual({
        isProcessing: true,
        isBundleReady: false,
        error: null,
      });
    });

    it('should throw InternalServerErrorException for failed bundle', async () => {
      const errorMessage = 'Bundle generation failed';
      const mockBundle = {
        status: SupportBundleStatus.FAILED,
        errorMessage,
      };
      supportBundleRepo.findOne.mockResolvedValue(mockBundle as any);

      await expect(service.isBundleReady(userId)).rejects.toThrow(
        new InternalServerErrorException(errorMessage)
      );

      expect(supportBundleRepo.findOne).toHaveBeenCalledWith({
        where: { userId },
        order: { createdAt: 'DESC' },
        select: ['status', 'errorMessage'],
      });
    });

    it('should throw InternalServerErrorException with default message when no error message provided', async () => {
      const mockBundle = {
        status: SupportBundleStatus.FAILED,
        errorMessage: null,
      };
      supportBundleRepo.findOne.mockResolvedValue(mockBundle as any);

      await expect(service.isBundleReady(userId)).rejects.toThrow(
        new InternalServerErrorException('Support bundle generation failed')
      );
    });

    it('should return default status for unknown status', async () => {
      const mockBundle = {
        status: 'UNKNOWN_STATUS',
        errorMessage: null,
      };
      supportBundleRepo.findOne.mockResolvedValue(mockBundle as any);

      const result = await service.isBundleReady(userId);

      expect(result).toEqual({
        isProcessing: false,
        isBundleReady: false,
        error: null,
      });
    });

    it('should return default status when no bundle found for user', async () => {
      supportBundleRepo.findOne.mockResolvedValue(null);

      const result = await service.isBundleReady(userId);

      expect(result).toEqual({
        isProcessing: false,
        isBundleReady: false,
        error: null,
      });
    });
  });

  describe('downloadSupportBundle', () => {
    const fileName = 'ndm_user-123.zip';
    const fullPath = '/test/bundle/path/ndm_user-123.zip';

    beforeEach(() => {
      (path.join as jest.Mock).mockReturnValue(fullPath);
    });

    it('should return file path when file exists', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const result = service.downloadSupportBundle(fileName);

      expect(path.join).toHaveBeenCalledWith(mockBundlePath, fileName);
      expect(fs.existsSync).toHaveBeenCalledWith(fullPath);
      expect(result).toBe(fullPath);
    });

    it('should throw NotFoundException when file does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      expect(() => service.downloadSupportBundle(fileName)).toThrow(NotFoundException);
      expect(() => service.downloadSupportBundle(fileName)).toThrow('Support bundle file not found.');
      expect(path.join).toHaveBeenCalledWith(mockBundlePath, fileName);
      expect(fs.existsSync).toHaveBeenCalledWith(fullPath);
    });

    it('should handle different file names correctly', () => {
      const differentFileName = 'custom-bundle.zip';
      const differentFullPath = '/test/bundle/path/custom-bundle.zip';
      (path.join as jest.Mock).mockReturnValue(differentFullPath);
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const result = service.downloadSupportBundle(differentFileName);

      expect(path.join).toHaveBeenCalledWith(mockBundlePath, differentFileName);
      expect(fs.existsSync).toHaveBeenCalledWith(differentFullPath);
      expect(result).toBe(differentFullPath);
    });
  });
});
