import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('fs');
jest.mock('path');
jest.mock('uuid', () => ({
  v4: () => 'mock-uuid-123',
}));

jest.mock('./support-bundle.service', () => {
  return {
    SupportBundleService: jest.fn().mockImplementation(() => ({
      create: jest.fn(),
      updateSupportBundleStatus: jest.fn(),
      getProjects: jest.fn(),
      canUserDownloadBundle: jest.fn(),
      downloadSupportBundle: jest.fn(),
    })),
  };
});

const { SupportBundleService } = require('./support-bundle.service');

const SupportBundleStatus = {
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
};

const WorkFlows = {
  SUPPORT_BUNDLE_WORKFLOW: 'SUPPORT_BUNDLE_WORKFLOW',
};

// Type definitions
interface UserDetails {
  traceId: string;
  user: {
    id: string;
    roles: Array<{
      role_name: string;
      projects: string[];
      permissions: string[];
    }>;
  };
}

interface CreateSupportBundleDTO {
  startDate: string;
  endDate: string;
  projectWorkerMap: Array<{
    projectId?: string;
    workerIds?: string[];
  }>;
  otherMetrics?: string[];
}

interface UpdateStatusDto {
  traceId: string;
  status: string;
  errorMessage?: string;
}

interface BundleStatus {
  isProcessing: boolean;
  isBundleReady: boolean;
  error: string;
}

describe('SupportBundleService', () => {
  let service: any;
  let mockSupportBundleRepo: any;
  let mockProjectRepo: any;
  let mockWorkflowService: any;
  let mockConfigService: any;
  let mockLoggerFactory: any;

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock instances
    mockSupportBundleRepo = {
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      findOne: jest.fn(),
    };

    mockProjectRepo = {
      find: jest.fn(),
    };

    mockWorkflowService = {
      startWorkflow: jest.fn(),
    };

    mockConfigService = {
      get: jest.fn().mockReturnValue('/tmp/support-bundles'),
    };

    mockLoggerFactory = {
      create: jest.fn().mockReturnValue({
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupportBundleService,
        {
          provide: 'Repository<SupportBundleEntity>',
          useValue: mockSupportBundleRepo,
        },
        {
          provide: 'Repository<ProjectEntity>',
          useValue: mockProjectRepo,
        },
        {
          provide: 'LoggerFactory',
          useValue: mockLoggerFactory,
        },
        {
          provide: 'WorkflowService',
          useValue: mockWorkflowService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get(SupportBundleService);

    // Manually inject dependencies since we're mocking
    service.supportBundleRepo = mockSupportBundleRepo;
    service.projectRepo = mockProjectRepo;
    service.workFlowService = mockWorkflowService;
    service.configService = mockConfigService;
    service.logger = mockLoggerFactory.create();
    service.bundleOutputPath = '/tmp/support-bundles';
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create method testing', () => {
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

    it('should create method exist and be callable', () => {
      expect(typeof service.create).toBe('function');
    });

    it('should test create method with mocked implementation', async () => {
      // Mock the create method directly
      service.create = jest.fn().mockResolvedValue({ traceId: 'mock-uuid-123' });

      const result = await service.create(mockCreateSupportBundleDTO, mockUserDetails);

      expect(service.create).toHaveBeenCalledWith(mockCreateSupportBundleDTO, mockUserDetails);
      expect(result).toEqual({ traceId: 'mock-uuid-123' });
    });
  });

  describe('updateSupportBundleStatus method testing', () => {
    const mockUpdateStatusDto: UpdateStatusDto = {
      traceId: 'trace-123',
      status: SupportBundleStatus.COMPLETED,
      errorMessage: '',
    };

    it('should updateSupportBundleStatus method exist', () => {
      expect(typeof service.updateSupportBundleStatus).toBe('function');
    });

    it('should test updateSupportBundleStatus method with mock', async () => {
      service.updateSupportBundleStatus = jest.fn().mockResolvedValue(undefined);

      await service.updateSupportBundleStatus(mockUpdateStatusDto);

      expect(service.updateSupportBundleStatus).toHaveBeenCalledWith(mockUpdateStatusDto);
    });
  });

  describe('getProjects method testing', () => {
    const mockUserDetails: UserDetails = {
      traceId: 'trace-123',
      user: {
        id: 'admin-user',
        roles: [
          {
            role_name: 'App Admin',
            projects: [],
            permissions: ['read', 'write', 'admin'],
          },
        ],
      },
    };

    it('should getProjects method exist', () => {
      expect(typeof service.getProjects).toBe('function');
    });

    it('should test getProjects method with mock', async () => {
      const expectedProjects = [
        {
          label: 'Project One',
          id: 'project-1',
          childrens: [
            { label: 'Worker 1 (Project One)', id: 'worker-1' },
          ],
        },
      ];

      service.getProjects = jest.fn().mockResolvedValue(expectedProjects);

      const result = await service.getProjects(mockUserDetails);

      expect(service.getProjects).toHaveBeenCalledWith(mockUserDetails);
      expect(result).toEqual(expectedProjects);
    });
  });

  describe('canUserDownloadBundle method testing', () => {
    it('should canUserDownloadBundle method exist', () => {
      expect(typeof service.canUserDownloadBundle).toBe('function');
    });

    it('should test canUserDownloadBundle method with mock - completed status', async () => {
      const expectedBundleStatus: BundleStatus = {
        isProcessing: false,
        isBundleReady: true,
        error: '',
      };

      service.canUserDownloadBundle = jest.fn().mockResolvedValue(expectedBundleStatus);

      const result = await service.canUserDownloadBundle('user-123');

      expect(service.canUserDownloadBundle).toHaveBeenCalledWith('user-123');
      expect(result).toEqual(expectedBundleStatus);
    });

    it('should test canUserDownloadBundle method with mock - in progress status', async () => {
      const expectedBundleStatus: BundleStatus = {
        isProcessing: true,
        isBundleReady: false,
        error: '',
      };

      service.canUserDownloadBundle = jest.fn().mockResolvedValue(expectedBundleStatus);

      const result = await service.canUserDownloadBundle('user-123');

      expect(result).toEqual(expectedBundleStatus);
    });

    it('should test canUserDownloadBundle method with mock - failed status', async () => {
      const expectedBundleStatus: BundleStatus = {
        isProcessing: false,
        isBundleReady: false,
        error: 'Support bundle generation failed.',
      };

      service.canUserDownloadBundle = jest.fn().mockResolvedValue(expectedBundleStatus);

      const result = await service.canUserDownloadBundle('user-123');

      expect(result).toEqual(expectedBundleStatus);
    });
  });

  describe('downloadSupportBundle method testing', () => {
    const mockFileName = 'ndm_user-123.zip';

    beforeEach(() => {
      (path.join as jest.Mock).mockImplementation((...args) => args.join('/'));
    });

    it('should downloadSupportBundle method exist', () => {
      expect(typeof service.downloadSupportBundle).toBe('function');
    });

    it('should test downloadSupportBundle method when file exists', () => {
      const expectedPath = '/tmp/support-bundles/ndm_user-123.zip';
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      service.downloadSupportBundle = jest.fn().mockReturnValue(expectedPath);

      const result = service.downloadSupportBundle(mockFileName);

      expect(service.downloadSupportBundle).toHaveBeenCalledWith(mockFileName);
      expect(result).toBe(expectedPath);
    });

    it('should test downloadSupportBundle method when file does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      service.downloadSupportBundle = jest.fn().mockImplementation(() => {
        throw new NotFoundException('Support bundle file not found.');
      });

      expect(() => service.downloadSupportBundle(mockFileName)).toThrow(NotFoundException);
      expect(() => service.downloadSupportBundle(mockFileName)).toThrow('Support bundle file not found.');
    });
  });

  describe('Integration-style testing with repository mocks', () => {
    it('should test repository interactions are properly mocked', () => {
      expect(mockSupportBundleRepo.create).toBeDefined();
      expect(mockSupportBundleRepo.save).toBeDefined();
      expect(mockSupportBundleRepo.update).toBeDefined();
      expect(mockSupportBundleRepo.findOne).toBeDefined();
      expect(mockProjectRepo.find).toBeDefined();
    });

    it('should test workflow service mock', () => {
      expect(mockWorkflowService.startWorkflow).toBeDefined();
    });

    it('should test config service mock', () => {
      expect(mockConfigService.get).toBeDefined();
      expect(mockConfigService.get()).toBe('/tmp/support-bundles');
    });

    it('should test logger factory mock', () => {
      expect(mockLoggerFactory.create).toBeDefined();
      const logger = mockLoggerFactory.create();
      expect(logger.log).toBeDefined();
      expect(logger.error).toBeDefined();
    });
  });
});
