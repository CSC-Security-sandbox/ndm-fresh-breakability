import { Test, TestingModule } from '@nestjs/testing';
import { SupportBundleService } from './support-bundle.service';
import {
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository, In } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SupportBundleEntity } from 'src/entities/support-bundle-log.entity';
import { ProjectEntity } from 'src/entities/project.entity';
import { WorkflowService } from 'src/workflow/workflow.service';
import { SupportBundleStatus, WorkFlows } from 'src/constants/enums';
import { UserDetails } from 'src/constants/types';
import { CreateSupportBundleDTO } from './dto/create-support-bundle.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import axios from 'axios';

// Mock dependencies
// Use factory mocks that spread jest.requireActual() so typeorm internal modules
// (e.g. path-scurry) continue to see real method implementations they depend on.
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  promises: {
    readFile: jest.fn(),
  },
}));
jest.mock('path', () => ({
  ...jest.requireActual('path'),
  join: jest.fn(),
}));
jest.mock('axios');
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



describe('SupportBundleService', () => {
  let service: SupportBundleService;
  let supportBundleRepo: jest.Mocked<Repository<SupportBundleEntity>>;
  let projectRepo: jest.Mocked<Repository<ProjectEntity>>;
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

    const projectRepoMock = {
      findBy: jest.fn(),
      find: jest.fn(),
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
          provide: getRepositoryToken(ProjectEntity),
          useValue: projectRepoMock,
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
    supportBundleRepo = module.get(
      getRepositoryToken(SupportBundleEntity),
    ) as jest.Mocked<Repository<SupportBundleEntity>>;
    projectRepo = module.get(getRepositoryToken(ProjectEntity)) as jest.Mocked<
      Repository<ProjectEntity>
    >;
    workflowService = module.get<WorkflowService>(
      WorkflowService,
    ) as jest.Mocked<WorkflowService>;
    configService = module.get<ConfigService>(
      ConfigService,
    ) as jest.Mocked<ConfigService>;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('constructor', () => {
    it('should initialize logger and bundle output path', () => {
      expect(mockLoggerFactory.create).toHaveBeenCalledWith(
        SupportBundleService.name,
      );
      expect(configService.get).toHaveBeenCalledWith(
        'app.bundle.bundleOutputPath',
      );
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
      projectWorkerMap: [
        {
          projectId: 'project-1',
          workerIds: ['worker-1', 'worker-2'],
        },
      ],
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
          projectWorkerMap: mockCreateDto.projectWorkerMap,
          otherMetrics: mockCreateDto.otherMetrics,
        },
      });
      expect(supportBundleRepo.save).toHaveBeenCalledWith(mockEntity);
      expect(workflowService.startWorkflow).toHaveBeenCalled();
      expect(mockLogger.log).toHaveBeenCalledWith(
        `Starting SupportBundleWorkflow with requestId: ${mockUuid} and userId: ${mockUserDetails.user.id}`,
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        'Started SupportBundleWorkflow successfully',
      );
    });

    it('should create support bundle with empty projectWorkerMap and otherMetrics when not provided', async () => {
      const dtoWithoutOptionalFields = {
        startDate: '2023-01-01T00:00:00Z',
        endDate: '2023-01-31T23:59:59Z',
        projectWorkerMap: [],
      };
      const mockEntity = { id: 1, requestId: mockUuid };
      supportBundleRepo.create.mockReturnValue(mockEntity as any);
      supportBundleRepo.save.mockResolvedValue(mockEntity as any);
      workflowService.startWorkflow.mockResolvedValue(undefined);

      const result = await service.create(
        dtoWithoutOptionalFields as CreateSupportBundleDTO,
        mockUserDetails,
      );

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
          projectWorkerMap: [],
          otherMetrics: [],
        },
      });
    });

    it('should log and rethrow when workflow start fails', async () => {
      const mockEntity = { id: 1, requestId: mockUuid };
      supportBundleRepo.create.mockReturnValue(mockEntity as any);
      supportBundleRepo.save.mockResolvedValue(mockEntity as any);
      const workflowError = new Error('Workflow failed');
      workflowService.startWorkflow.mockRejectedValue(workflowError);

      await expect(
        service.create(mockCreateDto, mockUserDetails),
      ).rejects.toThrow('Workflow failed');

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
                projectWorkerMap: mockCreateDto.projectWorkerMap,
                userId: mockUserDetails.user.id,
                otherMetrics: mockCreateDto.otherMetrics,
              }),
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

      await expect(
        service.updateSupportBundleStatus(mockUpdateDto),
      ).rejects.toThrow(
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
      const mockFilters = {
        startDate: '2023-01-01',
        endDate: '2023-01-31',
        projectWorkerMap: [],
        otherMetrics: [],
      };
      const mockCreatedAt = new Date('2023-01-01T10:00:00Z');
      const mockBundle = {
        status: SupportBundleStatus.COMPLETED,
        errorMessage: null,
        filters: mockFilters,
        createdAt: mockCreatedAt,
      };
      supportBundleRepo.findOne.mockResolvedValue(mockBundle as any);

      const result = await service.isBundleReady(userId);

      expect(supportBundleRepo.findOne).toHaveBeenCalledWith({
        where: { userId },
        order: { createdAt: 'DESC' },
        select: [
          'status',
          'errorMessage',
          'filters',
          'createdAt',
          'workflowId',
          'requestId',
        ],
      });
      expect(result).toEqual({
        isProcessing: false,
        isBundleReady: true,
        filters: mockFilters,
        createdAt: mockCreatedAt,
      });
    });

    it('should return processing status for in-progress bundle', async () => {
      const mockFilters = {
        startDate: '2023-01-01',
        endDate: '2023-01-31',
        projectWorkerMap: [],
        otherMetrics: ['metric1'],
      };
      const mockCreatedAt = new Date('2023-01-01T10:00:00Z');
      const mockBundle = {
        status: SupportBundleStatus.IN_PROGRESS,
        errorMessage: null,
        filters: mockFilters,
        createdAt: mockCreatedAt,
      };
      supportBundleRepo.findOne.mockResolvedValue(mockBundle as any);

      const result = await service.isBundleReady(userId);

      expect(result).toEqual({
        isProcessing: true,
        isBundleReady: false,
        filters: mockFilters,
        createdAt: mockCreatedAt,
      });
    });

    it('should throw InternalServerErrorException for failed bundle', async () => {
      const errorMessage = 'Bundle generation failed';
      const mockFilters = {
        startDate: '2023-01-01',
        endDate: '2023-01-31',
        projectWorkerMap: [],
        otherMetrics: [],
      };
      const mockCreatedAt = new Date('2023-01-01T10:00:00Z');
      const mockBundle = {
        status: SupportBundleStatus.FAILED,
        errorMessage,
        filters: mockFilters,
        createdAt: mockCreatedAt,
      };
      supportBundleRepo.findOne.mockResolvedValue(mockBundle as any);

      await expect(service.isBundleReady(userId)).rejects.toThrow(
        new InternalServerErrorException(errorMessage),
      );

      expect(supportBundleRepo.findOne).toHaveBeenCalledWith({
        where: { userId },
        order: { createdAt: 'DESC' },
        select: [
          'status',
          'errorMessage',
          'filters',
          'createdAt',
          'workflowId',
          'requestId',
        ],
      });
    });

    it('should throw InternalServerErrorException with default message when no error message provided', async () => {
      const mockFilters = {
        startDate: '2023-01-01',
        endDate: '2023-01-31',
        projectWorkerMap: [],
        otherMetrics: [],
      };
      const mockCreatedAt = new Date('2023-01-01T10:00:00Z');
      const mockBundle = {
        status: SupportBundleStatus.FAILED,
        errorMessage: null,
        filters: mockFilters,
        createdAt: mockCreatedAt,
      };
      supportBundleRepo.findOne.mockResolvedValue(mockBundle as any);

      await expect(service.isBundleReady(userId)).rejects.toThrow(
        new InternalServerErrorException('Support bundle generation failed'),
      );
    });

    it('should return default status for unknown status', async () => {
      const mockFilters = {
        startDate: '2023-01-01',
        endDate: '2023-01-31',
        projectWorkerMap: [],
        otherMetrics: [],
      };
      const mockCreatedAt = new Date('2023-01-01T10:00:00Z');
      const mockBundle = {
        status: 'UNKNOWN_STATUS',
        errorMessage: null,
        filters: mockFilters,
        createdAt: mockCreatedAt,
      };
      supportBundleRepo.findOne.mockResolvedValue(mockBundle as any);

      const result = await service.isBundleReady(userId);

      expect(result).toEqual({
        isProcessing: false,
        isBundleReady: false,
        filters: mockFilters,
        createdAt: mockCreatedAt,
      });
    });

    it('should return default status when no bundle found for user', async () => {
      supportBundleRepo.findOne.mockResolvedValue(null);

      const result = await service.isBundleReady(userId);

      expect(result).toEqual({
        isProcessing: false,
        isBundleReady: false,
        filters: null,
        createdAt: null,
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

      expect(() => service.downloadSupportBundle(fileName)).toThrow(
        NotFoundException,
      );
      expect(() => service.downloadSupportBundle(fileName)).toThrow(
        'Support bundle file not found.',
      );
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

  describe('getProjects', () => {
    const mockUserDetails = {
      user: {
        id: 'user-123',
        roles: [],
      },
    };

    describe('when user is app admin', () => {
      it('should return all projects when user has admin role (empty projects array)', async () => {
        const adminUserDetails = {
          user: {
            id: 'admin-123',
            roles: [{ projects: [] }], // Admin role has empty projects array
          },
        };

        const mockProjects = [
          {
            id: 'project-1',
            projectName: 'Project One',
            workers: [
              { workerId: 'worker-1', workerName: 'Worker 1' },
              { workerId: 'worker-2', workerName: 'Worker 2' },
            ],
          },
          {
            id: 'project-2',
            projectName: 'Project Two',
            workers: [],
          },
        ];

        projectRepo.find.mockResolvedValue(mockProjects as any);

        const result = await service.getProjects(adminUserDetails as any);

        expect(projectRepo.find).toHaveBeenCalledWith({
          select: ['id', 'projectName'],
          relations: ['workers'],
        });

        expect(result).toEqual([
          {
            label: 'Project One',
            id: 'project-1',
            childrens: [
              { label: 'Worker 1 (Project One)', id: 'worker-1' },
              { label: 'Worker 2 (Project One)', id: 'worker-2' },
            ],
          },
          {
            label: 'Project Two',
            id: 'project-2',
          },
        ]);
      });

      it('should return projects without childrens when no workers exist', async () => {
        const adminUserDetails = {
          user: {
            id: 'admin-123',
            roles: [{ projects: [] }],
          },
        };

        const mockProjects = [
          {
            id: 'project-1',
            projectName: 'Project One',
            workers: [],
          },
          {
            id: 'project-2',
            projectName: 'Project Two',
            workers: null,
          },
        ];

        projectRepo.find.mockResolvedValue(mockProjects as any);

        const result = await service.getProjects(adminUserDetails as any);

        expect(result).toEqual([
          {
            label: 'Project One',
            id: 'project-1',
          },
          {
            label: 'Project Two',
            id: 'project-2',
          },
        ]);
      });
    });

    describe('when user is not app admin', () => {
      it('should return only projects assigned to user with workers', async () => {
        const regularUserDetails = {
          user: {
            id: 'user-123',
            roles: [
              { projects: ['project-1', 'project-3'] },
              { projects: ['project-2'] },
            ],
          },
        };

        const mockProjects = [
          {
            id: 'project-1',
            projectName: 'Project One',
            workers: [{ workerId: 'worker-1', workerName: 'Worker 1' }],
          },
          {
            id: 'project-2',
            projectName: 'Project Two',
            workers: [{ workerId: 'worker-2', workerName: 'Worker 2' }],
          },
        ];

        projectRepo.find.mockResolvedValue(mockProjects as any);

        const result = await service.getProjects(regularUserDetails as any);

        expect(projectRepo.find).toHaveBeenCalledWith({
          where: { id: In(['project-1', 'project-3', 'project-2']) },
          select: ['id', 'projectName'],
          relations: ['workers'],
        });

        expect(result).toEqual([
          {
            label: 'Project One',
            id: 'project-1',
            childrens: [{ label: 'Worker 1 (Project One)', id: 'worker-1' }],
          },
          {
            label: 'Project Two',
            id: 'project-2',
            childrens: [{ label: 'Worker 2 (Project Two)', id: 'worker-2' }],
          },
        ]);
      });

      it('should handle duplicate project IDs in user roles', async () => {
        const regularUserDetails = {
          user: {
            id: 'user-123',
            roles: [
              { projects: ['project-1', 'project-2'] },
              { projects: ['project-1', 'project-3'] }, // project-1 is duplicate
            ],
          },
        };

        const mockProjects = [
          {
            id: 'project-1',
            projectName: 'Project One',
            workers: [],
          },
        ];

        projectRepo.find.mockResolvedValue(mockProjects as any);

        const result = await service.getProjects(regularUserDetails as any);

        // Should call with unique project IDs only
        expect(projectRepo.find).toHaveBeenCalledWith({
          where: { id: In(['project-1', 'project-2', 'project-3']) },
          select: ['id', 'projectName'],
          relations: ['workers'],
        });

        expect(result).toEqual([
          {
            label: 'Project One',
            id: 'project-1',
          },
        ]);
      });

      it('should return projects without childrens when workers array is empty', async () => {
        const regularUserDetails = {
          user: {
            id: 'user-123',
            roles: [{ projects: ['project-1'] }],
          },
        };

        const mockProjects = [
          {
            id: 'project-1',
            projectName: 'Project One',
            workers: [],
          },
        ];

        projectRepo.find.mockResolvedValue(mockProjects as any);

        const result = await service.getProjects(regularUserDetails as any);

        expect(result).toEqual([
          {
            label: 'Project One',
            id: 'project-1',
          },
        ]);
      });

      it('should handle empty roles array', async () => {
        const regularUserDetails = {
          user: {
            id: 'user-123',
            roles: [],
          },
        };

        projectRepo.find.mockResolvedValue([]);

        const result = await service.getProjects(regularUserDetails as any);

        expect(projectRepo.find).toHaveBeenCalledWith({
          where: { id: In([]) },
          select: ['id', 'projectName'],
          relations: ['workers'],
        });

        expect(result).toEqual([]);
      });
    });
  });

  describe('getAsupTransmissionStatus', () => {
    it('should return null when no transmission has been initiated for the given fileName', () => {
      const result = service.getAsupTransmissionStatus('nonexistent.zip');
      expect(result).toBeNull();
    });

    it('should return transmitting state while sendSupportBundleToAsup is still in progress', () => {
      const fileName = 'ndm_logs_user-123.zip';
      const fullPath = `/test/bundle/path/${fileName}`;

      let resolvePost: () => void;
      const pendingPost = new Promise<void>((resolve) => {
        resolvePost = resolve;
      });

      (path.join as jest.Mock).mockReturnValue(fullPath);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (axios.post as jest.Mock).mockReturnValue(pendingPost);

      service.sendSupportBundleToAsup(fileName);

      const immediateStatus = service.getAsupTransmissionStatus(fileName);
      expect(immediateStatus).not.toBeNull();
      expect(immediateStatus?.status).toBe('transmitting');
      expect(immediateStatus?.startedAt).toBeInstanceOf(Date);

      resolvePost!();
    });
  });

  describe('sendSupportBundleToAsup', () => {
    const fileName = 'ndm_logs_user-123.zip';
    const fullPath = `/test/bundle/path/${fileName}`;

    beforeEach(() => {
      (path.join as jest.Mock).mockReturnValue(fullPath);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
    });

    it('should set status to completed after successful transmission', async () => {
      (axios.post as jest.Mock).mockResolvedValue({ data: {} });

      await service.sendSupportBundleToAsup(fileName);

      const state = service.getAsupTransmissionStatus(fileName);
      expect(state).not.toBeNull();
      expect(state?.status).toBe('completed');
      expect(state?.startedAt).toBeInstanceOf(Date);
      expect(state?.completedAt).toBeInstanceOf(Date);
      expect(state?.error).toBeUndefined();
    });

    it('should set status to failed and re-throw when axios.post rejects', async () => {
      const axiosError = new Error('network error');
      (axios.post as jest.Mock).mockRejectedValue(axiosError);

      await expect(
        service.sendSupportBundleToAsup(fileName),
      ).rejects.toThrow('network error');

      const state = service.getAsupTransmissionStatus(fileName);
      expect(state?.status).toBe('failed');
      expect(state?.error).toBe(axiosError.message);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('network error'),
        expect.any(String),
      );
    });

    it('should set status to failed and re-throw when downloadSupportBundle throws NotFoundException', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(
        service.sendSupportBundleToAsup(fileName),
      ).rejects.toThrow(NotFoundException);

      const state = service.getAsupTransmissionStatus(fileName);
      expect(state?.status).toBe('failed');
    });

    it('should verify the file exists before posting to reports-service', async () => {
      (axios.post as jest.Mock).mockResolvedValue({ data: {} });

      await service.sendSupportBundleToAsup(fileName);

      expect(path.join).toHaveBeenCalledWith(mockBundlePath, fileName);
      expect(fs.existsSync).toHaveBeenCalledWith(fullPath);
    });

    it('should post only fileName to reports-service (no file data over HTTP)', async () => {
      (axios.post as jest.Mock).mockResolvedValue({ data: {} });

      await service.sendSupportBundleToAsup(fileName);

      expect(axios.post).toHaveBeenCalledWith(
        mockBundlePath,
        { fileName },
        { timeout: 0 },
      );
      expect(fs.promises.readFile).not.toHaveBeenCalled();
    });

    it('should allow a re-send overwriting the previous failed state with a new completed state', async () => {
      const axiosError = new Error('first failure');
      (axios.post as jest.Mock)
        .mockRejectedValueOnce(axiosError)
        .mockResolvedValueOnce({ data: {} });

      await expect(
        service.sendSupportBundleToAsup(fileName),
      ).rejects.toThrow('first failure');
      expect(service.getAsupTransmissionStatus(fileName)?.status).toBe('failed');

      await service.sendSupportBundleToAsup(fileName);
      expect(service.getAsupTransmissionStatus(fileName)?.status).toBe('completed');
    });
  });
});
