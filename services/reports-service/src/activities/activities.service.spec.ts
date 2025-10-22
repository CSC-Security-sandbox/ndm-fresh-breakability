import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { DiscoveryReportService } from './discovery-report/discovery-report.service';
import { ProjectIdCacheService } from '../utils/project-id-cache.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import {
  GenerateDiscoveryReportInput,
  GetDiscoverySectionInput,
  UpdateDiscoveryReportInput,
} from './discovery-report/discovery-report.type';

describe('ActivitiesService', () => {
  let service: ActivitiesService;
  let mockDiscoveryReportService: jest.Mocked<DiscoveryReportService>;
  let mockProjectIdCacheService: jest.Mocked<ProjectIdCacheService>;
  let mockLogger: any;
  let mockLoggerFactory: jest.Mocked<LoggerFactory>;

  beforeEach(async () => {
    // Mock logger
    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };

    // Mock LoggerFactory
    mockLoggerFactory = {
      create: jest.fn().mockReturnValue(mockLogger),
    } as any;

    // Mock DiscoveryReportService
    mockDiscoveryReportService = {
      getSection: jest.fn(),
      generatePdfReport: jest.fn(),
      generateCsvReport: jest.fn(),
      updateJsonReport: jest.fn(),
    } as any;

    // Mock ProjectIdCacheService
    mockProjectIdCacheService = {
      getProjectIdFromCache: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivitiesService,
        {
          provide: DiscoveryReportService,
          useValue: mockDiscoveryReportService,
        },
        {
          provide: ProjectIdCacheService,
          useValue: mockProjectIdCacheService,
        },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
      ],
    }).compile();

    service = module.get<ActivitiesService>(ActivitiesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should create service with LoggerFactory', () => {
      expect(mockLoggerFactory.create).toHaveBeenCalledWith('ActivitiesService');
    });

    it('should fallback to NestJS Logger when LoggerFactory is not provided', async () => {
      const moduleWithoutLogger: TestingModule = await Test.createTestingModule({
        providers: [
          ActivitiesService,
          {
            provide: DiscoveryReportService,
            useValue: mockDiscoveryReportService,
          },
          {
            provide: ProjectIdCacheService,
            useValue: mockProjectIdCacheService,
          },
        ],
      }).compile();

      const serviceWithoutLogger = moduleWithoutLogger.get<ActivitiesService>(ActivitiesService);
      expect(serviceWithoutLogger).toBeDefined();
    });
  });

  describe('generateDiscoveryJsonReport', () => {
    const mockInput: GetDiscoverySectionInput = {
      jobRunId: 'test-job-run-id',
      section: 'test-section',
      updateSection: false,
    };

    const mockProjectId = 'test-project-id';
    const mockResult = [
      {
        value: 'test-value',
        category: 'test-category',
        valueType: 'string',
        sub_category: 'test-sub-category',
      },
    ];

    beforeEach(() => {
      mockProjectIdCacheService.getProjectIdFromCache.mockResolvedValue(mockProjectId);
      mockDiscoveryReportService.getSection.mockResolvedValue(mockResult);
    });

    it('should generate discovery JSON report successfully', async () => {
      const result = await service.generateDiscoveryJsonReport(mockInput);

      expect(mockProjectIdCacheService.getProjectIdFromCache).toHaveBeenCalledWith(mockInput.jobRunId);
      expect(mockLogger.log).toHaveBeenCalledWith(
        `projectId: ${mockProjectId} Starting generateDiscoveryJsonReport for jobRunId: ${mockInput.jobRunId}, section: ${mockInput.section}`
      );
      expect(mockDiscoveryReportService.getSection).toHaveBeenCalledWith(mockInput);
      expect(mockLogger.log).toHaveBeenCalledWith(
        `projectId: ${mockProjectId} Completed generateDiscoveryJsonReport for jobRunId: ${mockInput.jobRunId}, section: ${mockInput.section}`
      );
      expect(result).toBe(mockResult);
    });

    it('should handle errors and log them with project ID', async () => {
      const mockError = new Error('Test error');
      mockDiscoveryReportService.getSection.mockRejectedValue(mockError);

      await expect(service.generateDiscoveryJsonReport(mockInput)).rejects.toThrow(mockError);

      expect(mockProjectIdCacheService.getProjectIdFromCache).toHaveBeenCalledWith(mockInput.jobRunId);
      expect(mockLogger.log).toHaveBeenCalledWith(
        `projectId: ${mockProjectId} Starting generateDiscoveryJsonReport for jobRunId: ${mockInput.jobRunId}, section: ${mockInput.section}`
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        `projectId: ${mockProjectId} Error in generateDiscoveryJsonReport for jobRunId: ${mockInput.jobRunId}, section: ${mockInput.section}: ${mockError.message}`,
        mockError.stack
      );
    });

    it('should handle errors without stack trace', async () => {
      const mockError = new Error('Test error without stack');
      delete mockError.stack; // Remove stack property
      mockDiscoveryReportService.getSection.mockRejectedValue(mockError);

      await expect(service.generateDiscoveryJsonReport(mockInput)).rejects.toThrow(mockError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        `projectId: ${mockProjectId} Error in generateDiscoveryJsonReport for jobRunId: ${mockInput.jobRunId}, section: ${mockInput.section}: ${mockError.message}`,
        mockError
      );
    });
  });

  describe('generateDiscoveryPdfReport', () => {
    const mockInput: GenerateDiscoveryReportInput = {
      jobRunId: 'test-job-run-id',
    };

    const mockProjectId = 'test-project-id';
    const mockResult = { message: 'PDF report generated successfully', path: 'test-file-path' };

    beforeEach(() => {
      mockProjectIdCacheService.getProjectIdFromCache.mockResolvedValue(mockProjectId);
      mockDiscoveryReportService.generatePdfReport.mockResolvedValue(mockResult);
    });

    it('should generate discovery PDF report successfully', async () => {
      const result = await service.generateDiscoveryPdfReport(mockInput);

      expect(mockProjectIdCacheService.getProjectIdFromCache).toHaveBeenCalledWith(mockInput.jobRunId);
      expect(mockLogger.log).toHaveBeenCalledWith(
        `projectId: ${mockProjectId} Starting generateDiscoveryPdfReport for jobRunId: ${mockInput.jobRunId}`
      );
      expect(mockDiscoveryReportService.generatePdfReport).toHaveBeenCalledWith(mockInput);
      expect(mockLogger.log).toHaveBeenCalledWith(
        `projectId: ${mockProjectId} Completed generateDiscoveryPdfReport for jobRunId: ${mockInput.jobRunId}`
      );
      expect(result).toBe(mockResult);
    });

    it('should handle errors and log them with project ID', async () => {
      const mockError = new Error('PDF generation failed');
      mockDiscoveryReportService.generatePdfReport.mockRejectedValue(mockError);

      await expect(service.generateDiscoveryPdfReport(mockInput)).rejects.toThrow(mockError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        `projectId: ${mockProjectId} Error in generateDiscoveryPdfReport for jobRunId: ${mockInput.jobRunId}: ${mockError.message}`,
        mockError.stack
      );
    });
  });

  describe('generateDiscoveryCsvReport', () => {
    const mockInput: GenerateDiscoveryReportInput = {
      jobRunId: 'test-job-run-id',
    };

    const mockProjectId = 'test-project-id';
    const mockResult = { message: 'CSV report generated successfully', path: 'test-csv-file-path' };

    beforeEach(() => {
      mockProjectIdCacheService.getProjectIdFromCache.mockResolvedValue(mockProjectId);
      mockDiscoveryReportService.generateCsvReport.mockResolvedValue(mockResult);
    });

    it('should generate discovery CSV report successfully', async () => {
      const result = await service.generateDiscoveryCsvReport(mockInput);

      expect(mockProjectIdCacheService.getProjectIdFromCache).toHaveBeenCalledWith(mockInput.jobRunId);
      expect(mockLogger.log).toHaveBeenCalledWith(
        `projectId: ${mockProjectId} Starting generateDiscoveryCsvReport for jobRunId: ${mockInput.jobRunId}`
      );
      expect(mockDiscoveryReportService.generateCsvReport).toHaveBeenCalledWith(mockInput);
      expect(mockLogger.log).toHaveBeenCalledWith(
        `projectId: ${mockProjectId} Completed generateDiscoveryCsvReport for jobRunId: ${mockInput.jobRunId}`
      );
      expect(result).toBe(mockResult);
    });

    it('should handle errors and log them with project ID', async () => {
      const mockError = new Error('CSV generation failed');
      mockDiscoveryReportService.generateCsvReport.mockRejectedValue(mockError);

      await expect(service.generateDiscoveryCsvReport(mockInput)).rejects.toThrow(mockError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        `projectId: ${mockProjectId} Error in generateDiscoveryCsvReport for jobRunId: ${mockInput.jobRunId}: ${mockError.message}`,
        mockError.stack
      );
    });
  });

  describe('updateDiscoveryReport', () => {
    const mockInput: UpdateDiscoveryReportInput = {
      jobRunId: 'test-job-run-id',
      updateType: 'status',
    };

    const mockProjectId = 'test-project-id';
    const mockResult = 'Updated The report status Successfully';

    beforeEach(() => {
      mockProjectIdCacheService.getProjectIdFromCache.mockResolvedValue(mockProjectId);
      mockDiscoveryReportService.updateJsonReport.mockResolvedValue(mockResult);
    });

    it('should update discovery report successfully', async () => {
      const result = await service.updateDiscoveryReport(mockInput);

      expect(mockProjectIdCacheService.getProjectIdFromCache).toHaveBeenCalledWith(mockInput.jobRunId);
      expect(mockLogger.log).toHaveBeenCalledWith(
        `projectId: ${mockProjectId} Starting updateDiscoveryReport for jobRunId: ${mockInput.jobRunId}, updateType: ${mockInput.updateType}`
      );
      expect(mockDiscoveryReportService.updateJsonReport).toHaveBeenCalledWith(mockInput);
      expect(mockLogger.log).toHaveBeenCalledWith(
        `projectId: ${mockProjectId} Completed updateDiscoveryReport for jobRunId: ${mockInput.jobRunId}, updateType: ${mockInput.updateType}`
      );
      expect(result).toBe(mockResult);
    });

    it('should handle errors and log them with project ID', async () => {
      const mockError = new Error('Update failed');
      mockDiscoveryReportService.updateJsonReport.mockRejectedValue(mockError);

      await expect(service.updateDiscoveryReport(mockInput)).rejects.toThrow(mockError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        `projectId: ${mockProjectId} Error in updateDiscoveryReport for jobRunId: ${mockInput.jobRunId}, updateType: ${mockInput.updateType}: ${mockError.message}`,
        mockError.stack
      );
    });

    it('should handle different update types', async () => {
      const inputWithDifferentType: UpdateDiscoveryReportInput = {
        ...mockInput,
        updateType: 'data' as const,
        data: [
          {
            value: 'test-value',
            category: 'test-category',
            valueType: 'string',
            sub_category: 'test-sub-category',
          },
        ],
      };
      
      mockDiscoveryReportService.updateJsonReport.mockResolvedValue('Updated The report Data Successfully');

      await service.updateDiscoveryReport(inputWithDifferentType);

      expect(mockLogger.log).toHaveBeenCalledWith(
        `projectId: ${mockProjectId} Starting updateDiscoveryReport for jobRunId: ${inputWithDifferentType.jobRunId}, updateType: ${inputWithDifferentType.updateType}`
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        `projectId: ${mockProjectId} Completed updateDiscoveryReport for jobRunId: ${inputWithDifferentType.jobRunId}, updateType: ${inputWithDifferentType.updateType}`
      );
    });
  });

  describe('error handling edge cases', () => {
    it('should handle projectIdCacheService errors', async () => {
      const mockInput: GetDiscoverySectionInput = {
        jobRunId: 'test-job-run-id',
        section: 'test-section',
        updateSection: false,
      };

      const cacheError = new Error('Cache lookup failed');
      mockProjectIdCacheService.getProjectIdFromCache.mockRejectedValue(cacheError);

      await expect(service.generateDiscoveryJsonReport(mockInput)).rejects.toThrow(cacheError);
      expect(mockProjectIdCacheService.getProjectIdFromCache).toHaveBeenCalledWith(mockInput.jobRunId);
    });

    it('should handle null projectId from cache', async () => {
      const mockInput: GetDiscoverySectionInput = {
        jobRunId: 'test-job-run-id',
        section: 'test-section',
        updateSection: false,
      };

      mockProjectIdCacheService.getProjectIdFromCache.mockResolvedValue(null);
      mockDiscoveryReportService.getSection.mockResolvedValue([]);

      await service.generateDiscoveryJsonReport(mockInput);

      expect(mockLogger.log).toHaveBeenCalledWith(
        `projectId: null Starting generateDiscoveryJsonReport for jobRunId: ${mockInput.jobRunId}, section: ${mockInput.section}`
      );
    });
  });

  describe('logging functionality', () => {
    it('should log with correct project ID context for all methods', async () => {
      const projectId = 'consistent-project-id';
      const jobRunId = 'consistent-job-run-id';
      
      mockProjectIdCacheService.getProjectIdFromCache.mockResolvedValue(projectId);
      mockDiscoveryReportService.getSection.mockResolvedValue([]);
      mockDiscoveryReportService.generatePdfReport.mockResolvedValue({ message: 'Success', path: '/path' });
      mockDiscoveryReportService.generateCsvReport.mockResolvedValue({ message: 'Success', path: '/path' });
      mockDiscoveryReportService.updateJsonReport.mockResolvedValue('Updated The report status Successfully');

      // Test all methods use the same project ID in logs
      await service.generateDiscoveryJsonReport({ jobRunId, section: 'test', updateSection: false });
      await service.generateDiscoveryPdfReport({ jobRunId });
      await service.generateDiscoveryCsvReport({ jobRunId });
      await service.updateDiscoveryReport({ jobRunId, updateType: 'status' });

      // Verify all calls used the same project ID
      const logCalls = mockLogger.log.mock.calls;
      logCalls.forEach(call => {
        expect(call[0]).toContain(`projectId: ${projectId}`);
      });
    });
  });

  describe('error handling without stack traces', () => {
    const mockProjectId = 'test-project-id';

    beforeEach(() => {
      mockProjectIdCacheService.getProjectIdFromCache.mockResolvedValue(mockProjectId);
    });

    it('should handle PDF generation errors without stack trace', async () => {
      const mockError = new Error('PDF generation failed');
      delete mockError.stack; // Remove stack property
      mockDiscoveryReportService.generatePdfReport.mockRejectedValue(mockError);

      const mockInput: GenerateDiscoveryReportInput = { jobRunId: 'test-job-run-id' };

      await expect(service.generateDiscoveryPdfReport(mockInput)).rejects.toThrow(mockError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        `projectId: ${mockProjectId} Error in generateDiscoveryPdfReport for jobRunId: ${mockInput.jobRunId}: ${mockError.message}`,
        mockError
      );
    });

    it('should handle CSV generation errors without stack trace', async () => {
      const mockError = new Error('CSV generation failed');
      delete mockError.stack; // Remove stack property
      mockDiscoveryReportService.generateCsvReport.mockRejectedValue(mockError);

      const mockInput: GenerateDiscoveryReportInput = { jobRunId: 'test-job-run-id' };

      await expect(service.generateDiscoveryCsvReport(mockInput)).rejects.toThrow(mockError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        `projectId: ${mockProjectId} Error in generateDiscoveryCsvReport for jobRunId: ${mockInput.jobRunId}: ${mockError.message}`,
        mockError
      );
    });

    it('should handle update report errors without stack trace', async () => {
      const mockError = new Error('Update failed');
      delete mockError.stack; // Remove stack property
      mockDiscoveryReportService.updateJsonReport.mockRejectedValue(mockError);

      const mockInput: UpdateDiscoveryReportInput = { 
        jobRunId: 'test-job-run-id',
        updateType: 'status'
      };

      await expect(service.updateDiscoveryReport(mockInput)).rejects.toThrow(mockError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        `projectId: ${mockProjectId} Error in updateDiscoveryReport for jobRunId: ${mockInput.jobRunId}, updateType: ${mockInput.updateType}: ${mockError.message}`,
        mockError
      );
    });
  });
});