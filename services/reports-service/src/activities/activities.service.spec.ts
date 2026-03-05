import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { DiscoveryReportService } from './discovery-report/discovery-report.service';
import { ConsolidatedReportService } from './consolidated-report/consolidated-report.service';  
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
  let mockConsolidatedReportService: jest.Mocked<ConsolidatedReportService>;
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

    // Mock ConsolidatedReportService
    mockConsolidatedReportService = {
      getDiscoveryJobsForFileServer: jest.fn(),
      generatePdfForJobRun: jest.fn(),
      generateCsvForJobRun: jest.fn(),
      mergePdfFiles: jest.fn(),
      mergeCsvFiles: jest.fn(),
      getConsolidatedReportPath: jest.fn(),
      cleanupTempFiles: jest.fn(),
      updateConsolidatedReportStatus: jest.fn(),
      getConsolidatedReportStatus: jest.fn(),
      initializeStatus: jest.fn(),
      getReportFilePath: jest.fn(),
      readReportFile: jest.fn(),
      clearStatus: jest.fn(),
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
          provide: ConsolidatedReportService,
          useValue: mockConsolidatedReportService,
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
            provide: ConsolidatedReportService,
            useValue: mockConsolidatedReportService,
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

  describe('Consolidated Report Activities', () => {
    describe('getDiscoveryJobsForFileServer', () => {
      it('should log and call service method', async () => {
        const input = { fileServerId: 'test-fs' };
        mockConsolidatedReportService.getDiscoveryJobsForFileServer.mockResolvedValue([
          { jobRunId: 'job-1', volumePath: '/vol1' },
        ] as any);

        const result = await service.getDiscoveryJobsForFileServer(input);

        expect(result).toHaveLength(1);
        expect(mockConsolidatedReportService.getDiscoveryJobsForFileServer).toHaveBeenCalledWith(input);
        expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('Starting getDiscoveryJobsForFileServer'));
      });

      it('should handle errors from service', async () => {
        const input = { fileServerId: 'test-fs' };
        const error = new Error('Service error');
        mockConsolidatedReportService.getDiscoveryJobsForFileServer.mockRejectedValue(error);

        await expect(service.getDiscoveryJobsForFileServer(input)).rejects.toThrow('Service error');
        expect(mockLogger.error).toHaveBeenCalled();
      });

      it('should pass error (no stack) to logger when error has no stack', async () => {
        const input = { fileServerId: 'test-fs' };
        const error = new Error('No stack error');
        delete (error as any).stack;
        mockConsolidatedReportService.getDiscoveryJobsForFileServer.mockRejectedValue(error);

        await expect(service.getDiscoveryJobsForFileServer(input)).rejects.toThrow(error);
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('Error in getDiscoveryJobsForFileServer'),
          error
        );
      });

      it('should return empty array when no jobs found', async () => {
        const input = { fileServerId: 'test-fs' };
        mockConsolidatedReportService.getDiscoveryJobsForFileServer.mockResolvedValue([]);

        const result = await service.getDiscoveryJobsForFileServer(input);

        expect(result).toEqual([]);
      });

      it('should handle multiple jobs for a file server', async () => {
        const input = { fileServerId: 'test-fs' };
        const jobs = [
          { jobRunId: 'job-1', volumePath: '/vol1' },
          { jobRunId: 'job-2', volumePath: '/vol2' },
          { jobRunId: 'job-3', volumePath: '/vol3' },
        ];
        mockConsolidatedReportService.getDiscoveryJobsForFileServer.mockResolvedValue(jobs as any);

        const result = await service.getDiscoveryJobsForFileServer(input);

        expect(result).toHaveLength(3);
        expect(result).toEqual(jobs);
      });
    });

    describe('generateCsvForJobRun', () => {
      it('should generate CSV successfully', async () => {
        const input = { jobRunId: 'job-1', volumePath: '/vol1' };
        const csvPath = '/tmp/report-1.csv';
        mockConsolidatedReportService.generateCsvForJobRun.mockResolvedValue(csvPath);

        const result = await service.generateCsvForJobRun(input);

        expect(result).toBe(csvPath);
        expect(mockConsolidatedReportService.generateCsvForJobRun).toHaveBeenCalledWith(input);
        expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('Starting generateCsvForJobRun'));
        expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('Completed generateCsvForJobRun'));
      });

      it('should return null when CSV generation returns null', async () => {
        const input = { jobRunId: 'job-1', volumePath: '/vol1' };
        mockConsolidatedReportService.generateCsvForJobRun.mockResolvedValue(null);

        const result = await service.generateCsvForJobRun(input);

        expect(result).toBeNull();
      });

      it('should log errors when CSV generation fails', async () => {
        const input = { jobRunId: 'job-1', volumePath: '/vol1' };
        const error = new Error('CSV generation failed');
        mockConsolidatedReportService.generateCsvForJobRun.mockRejectedValue(error);

        await expect(service.generateCsvForJobRun(input)).rejects.toThrow('CSV generation failed');
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('Error in generateCsvForJobRun'),
          expect.anything()
        );
      });

      it('should pass error (no stack) to logger when CSV generation fails', async () => {
        const input = { jobRunId: 'job-1', volumePath: '/vol1' };
        const error = new Error('CSV fail');
        delete (error as any).stack;
        mockConsolidatedReportService.generateCsvForJobRun.mockRejectedValue(error);
        await expect(service.generateCsvForJobRun(input)).rejects.toThrow(error);
        expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Error in generateCsvForJobRun'), error);
      });
    });

    describe('generatePdfForJobRun', () => {
      it('should generate PDF successfully', async () => {
        const input = { jobRunId: 'job-1', volumePath: '/vol1' };
        const pdfPath = '/tmp/pdf-1.pdf';
        mockConsolidatedReportService.generatePdfForJobRun.mockResolvedValue(pdfPath);

        const result = await service.generatePdfForJobRun(input);

        expect(result).toBe(pdfPath);
        expect(mockConsolidatedReportService.generatePdfForJobRun).toHaveBeenCalledWith(input);
      });

      it('should handle null when PDF generation returns null', async () => {
        const input = { jobRunId: 'job-1', volumePath: '/vol1' };
        mockConsolidatedReportService.generatePdfForJobRun.mockResolvedValue(null);

        const result = await service.generatePdfForJobRun(input);

        expect(result).toBeNull();
      });

      it('should log errors', async () => {
        const input = { jobRunId: 'job-1', volumePath: '/vol1' };
        const error = new Error('PDF generation failed');
        mockConsolidatedReportService.generatePdfForJobRun.mockRejectedValue(error);

        await expect(service.generatePdfForJobRun(input)).rejects.toThrow();
        expect(mockLogger.error).toHaveBeenCalled();
      });

      it('should pass error (no stack) to logger when PDF generation fails', async () => {
        const input = { jobRunId: 'job-1', volumePath: '/vol1' };
        const error = new Error('PDF fail');
        delete (error as any).stack;
        mockConsolidatedReportService.generatePdfForJobRun.mockRejectedValue(error);
        await expect(service.generatePdfForJobRun(input)).rejects.toThrow(error);
        expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Error in generatePdfForJobRun'), error);
      });

      it('should handle PDF generation for multiple volumes', async () => {
        const inputs = [
          { jobRunId: 'job-1', volumePath: '/vol1' },
          { jobRunId: 'job-1', volumePath: '/vol2' },
        ];
        const paths = ['/tmp/pdf-1.pdf', '/tmp/pdf-2.pdf'];

        for (let i = 0; i < inputs.length; i++) {
          mockConsolidatedReportService.generatePdfForJobRun.mockResolvedValueOnce(paths[i]);
          const result = await service.generatePdfForJobRun(inputs[i]);
          expect(result).toBe(paths[i]);
        }

        expect(mockConsolidatedReportService.generatePdfForJobRun).toHaveBeenCalledTimes(2);
      });
    });

    describe('mergePdfFilesActivity', () => {
      it('should merge PDFs successfully', async () => {
        const input = {
          pdfFilePaths: ['/tmp/pdf-1.pdf', '/tmp/pdf-2.pdf'],
          outputPath: '/tmp/merged.pdf',
        };
        mockConsolidatedReportService.mergePdfFiles.mockResolvedValue('/tmp/merged.pdf');

        const result = await service.mergePdfFilesActivity(input);

        expect(result).toBe('/tmp/merged.pdf');
        expect(mockConsolidatedReportService.mergePdfFiles).toHaveBeenCalledWith(input);
      });

      it('should handle merge errors', async () => {
        const input = {
          pdfFilePaths: ['/tmp/pdf-1.pdf'],
          outputPath: '/tmp/merged.pdf',
        };
        const error = new Error('Merge failed');
        mockConsolidatedReportService.mergePdfFiles.mockRejectedValue(error);

        await expect(service.mergePdfFilesActivity(input)).rejects.toThrow();
      });

      it('should pass error (no stack) to logger when merge fails', async () => {
        const input = { pdfFilePaths: ['/tmp/1.pdf'], outputPath: '/out.pdf' };
        const error = new Error('Merge fail');
        delete (error as any).stack;
        mockConsolidatedReportService.mergePdfFiles.mockRejectedValue(error);
        await expect(service.mergePdfFilesActivity(input)).rejects.toThrow(error);
        expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Error in mergePdfFilesActivity'), error);
      });

      it('should handle single file merge', async () => {
        const input = {
          pdfFilePaths: ['/tmp/pdf-1.pdf'],
          outputPath: '/tmp/merged.pdf',
        };
        mockConsolidatedReportService.mergePdfFiles.mockResolvedValue('/tmp/merged.pdf');

        const result = await service.mergePdfFilesActivity(input);

        expect(result).toBe('/tmp/merged.pdf');
      });

      it('should handle multiple file merge', async () => {
        const input = {
          pdfFilePaths: ['/tmp/pdf-1.pdf', '/tmp/pdf-2.pdf', '/tmp/pdf-3.pdf', '/tmp/pdf-4.pdf'],
          outputPath: '/tmp/merged.pdf',
        };
        mockConsolidatedReportService.mergePdfFiles.mockResolvedValue('/tmp/merged.pdf');

        const result = await service.mergePdfFilesActivity(input);

        expect(result).toBe('/tmp/merged.pdf');
        expect(mockConsolidatedReportService.mergePdfFiles).toHaveBeenCalledWith(input);
      });

      it('should log merge activity', async () => {
        const input = {
          pdfFilePaths: ['/tmp/pdf-1.pdf', '/tmp/pdf-2.pdf'],
          outputPath: '/tmp/merged.pdf',
        };
        mockConsolidatedReportService.mergePdfFiles.mockResolvedValue('/tmp/merged.pdf');

        await service.mergePdfFilesActivity(input);

        expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('Completed mergePdfFilesActivity'));
      });
    });

    describe('mergeCsvFilesActivity', () => {
      it('should merge CSVs successfully', async () => {
        const input = {
          csvFilePaths: ['/tmp/1.csv', '/tmp/2.csv'],
          outputPath: '/tmp/merged.csv',
        };
        mockConsolidatedReportService.mergeCsvFiles.mockResolvedValue('/tmp/merged.csv');

        const result = await service.mergeCsvFilesActivity(input);

        expect(result).toBe('/tmp/merged.csv');
        expect(mockConsolidatedReportService.mergeCsvFiles).toHaveBeenCalledWith(input);
        expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('Starting mergeCsvFilesActivity with 2 files'));
        expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('Completed mergeCsvFilesActivity'));
      });

      it('should handle merge CSV errors', async () => {
        const input = {
          csvFilePaths: ['/tmp/1.csv'],
          outputPath: '/tmp/merged.csv',
        };
        const error = new Error('Merge CSV failed');
        mockConsolidatedReportService.mergeCsvFiles.mockRejectedValue(error);

        await expect(service.mergeCsvFilesActivity(input)).rejects.toThrow('Merge CSV failed');
        expect(mockLogger.error).toHaveBeenCalled();
      });

      it('should pass error (no stack) to logger when merge CSV fails', async () => {
        const input = { csvFilePaths: ['/tmp/1.csv'], outputPath: '/out.csv' };
        const error = new Error('Merge CSV fail');
        delete (error as any).stack;
        mockConsolidatedReportService.mergeCsvFiles.mockRejectedValue(error);
        await expect(service.mergeCsvFilesActivity(input)).rejects.toThrow(error);
        expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Error in mergeCsvFilesActivity'), error);
      });
    });

    describe('getConsolidatedReportPathActivity', () => {
      it('should get report path successfully', async () => {
        const input = { fileServerId: 'test-fs', configName: 'TestConfig' };
        const path = '/reports/test-config-consolidated-report.pdf';
        mockConsolidatedReportService.getConsolidatedReportPath.mockResolvedValue(path);

        const result = await service.getConsolidatedReportPathActivity(input);

        expect(result).toBe(path);
        expect(mockConsolidatedReportService.getConsolidatedReportPath).toHaveBeenCalledWith(input);
      });

      it('should handle path generation errors', async () => {
        const input = { fileServerId: 'test-fs', configName: 'TestConfig' };
        const error = new Error('Path generation failed');
        mockConsolidatedReportService.getConsolidatedReportPath.mockRejectedValue(error);

        await expect(service.getConsolidatedReportPathActivity(input)).rejects.toThrow();
      });

      it('should pass error (no stack) to logger when path generation fails', async () => {
        const input = { fileServerId: 'test-fs', configName: 'TestConfig' };
        const error = new Error('Path fail');
        delete (error as any).stack;
        mockConsolidatedReportService.getConsolidatedReportPath.mockRejectedValue(error);
        await expect(service.getConsolidatedReportPathActivity(input)).rejects.toThrow(error);
        expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Error in getConsolidatedReportPath'), error);
      });

      it('should log activity start and completion', async () => {
        const input = { fileServerId: 'test-fs', configName: 'TestConfig' };
        const path = '/reports/test-config-consolidated-report.pdf';
        mockConsolidatedReportService.getConsolidatedReportPath.mockResolvedValue(path);

        await service.getConsolidatedReportPathActivity(input);

        expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('getConsolidatedReportPath'));
        expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('Completed'));
      });

      it('should handle different config names', async () => {
        const configs = ['TestConfig', 'ProdConfig', 'DevConfig'];
        
        for (const configName of configs) {
          const input = { fileServerId: 'test-fs', configName };
          const path = `/reports/${configName}-consolidated-report.pdf`;
          mockConsolidatedReportService.getConsolidatedReportPath.mockResolvedValueOnce(path);

          const result = await service.getConsolidatedReportPathActivity(input);

          expect(result).toBe(path);
        }
      });
    });

    describe('cleanupTempFilesActivity', () => {
      it('should cleanup temp files successfully', async () => {
        const input = { filePaths: ['/tmp/pdf-1.pdf', '/tmp/pdf-2.pdf'] };
        mockConsolidatedReportService.cleanupTempFiles.mockResolvedValue(undefined);
        await service.cleanupTempFilesActivity(input);

        expect(mockConsolidatedReportService.cleanupTempFiles).toHaveBeenCalledWith(input);
      });

      it('should handle cleanup errors gracefully', async () => {
        const input = { filePaths: ['/tmp/pdf-1.pdf'] };
        const error = new Error('Cleanup failed');
        mockConsolidatedReportService.cleanupTempFiles.mockRejectedValue(error);
        await expect(service.cleanupTempFilesActivity(input)).rejects.toThrow('Cleanup failed');
      });

      it('should pass error (no stack) to logger when cleanup fails', async () => {
        const input = { filePaths: ['/tmp/1.pdf'] };
        const error = new Error('Cleanup fail');
        delete (error as any).stack;
        mockConsolidatedReportService.cleanupTempFiles.mockRejectedValue(error);
        await expect(service.cleanupTempFilesActivity(input)).rejects.toThrow(error);
        expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Error in cleanupTempFilesActivity'), error);
      });

      it('should handle empty file paths', async () => {
        const input = { filePaths: [] };
        mockConsolidatedReportService.cleanupTempFiles.mockResolvedValue(undefined);
        await service.cleanupTempFilesActivity(input);
        expect(mockConsolidatedReportService.cleanupTempFiles).toHaveBeenCalledWith(input);
      });

      it('should cleanup multiple files', async () => {
        const input = { filePaths: ['/tmp/pdf-1.pdf', '/tmp/pdf-2.pdf', '/tmp/pdf-3.pdf', '/tmp/pdf-4.pdf'] };
        mockConsolidatedReportService.cleanupTempFiles.mockResolvedValue(undefined);
        await service.cleanupTempFilesActivity(input);
        expect(mockConsolidatedReportService.cleanupTempFiles).toHaveBeenCalledWith(input);
      });

      it('should log cleanup completion', async () => {
        const input = { filePaths: ['/tmp/pdf-1.pdf', '/tmp/pdf-2.pdf'] };
        mockConsolidatedReportService.cleanupTempFiles.mockResolvedValue(undefined);
        await service.cleanupTempFilesActivity(input);
        expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('Completed cleanupTempFilesActivity'));
      });

      it('should log errors during cleanup', async () => {
        const input = { filePaths: ['/tmp/pdf-1.pdf'] };
        const error = new Error('Cleanup failed');
        mockConsolidatedReportService.cleanupTempFiles.mockRejectedValue(error);
        await expect(service.cleanupTempFilesActivity(input)).rejects.toThrow('Cleanup failed');
        expect(mockLogger.error).toHaveBeenCalled();
      });
    });

    describe('updateConsolidatedReportStatus', () => {
      it('should update status successfully', async () => {
        const input = {
          fileServerId: 'test-fs',
          status: 'COMPLETED' as const,
          reportPath: '/path/to/report.pdf',
        };
        mockConsolidatedReportService.updateConsolidatedReportStatus.mockResolvedValue(undefined);

        await service.updateConsolidatedReportStatus(input);

        expect(mockConsolidatedReportService.updateConsolidatedReportStatus).toHaveBeenCalledWith(input);
      });

      it('should handle status update errors', async () => {
        const input = {
          fileServerId: 'test-fs',
          status: 'FAILED' as const,
          errorMessage: 'Generation failed',
        };
        const error = new Error('Status update failed');
        mockConsolidatedReportService.updateConsolidatedReportStatus.mockRejectedValue(error);

        await expect(service.updateConsolidatedReportStatus(input)).rejects.toThrow();
      });

      it('should handle PARTIAL status', async () => {
        const input = {
          fileServerId: 'test-fs',
          status: 'PARTIAL' as const,
          failedJobs: 2,
          failedVolumes: ['/vol1', '/vol2'],
        };
        mockConsolidatedReportService.updateConsolidatedReportStatus.mockResolvedValue(undefined);

        await service.updateConsolidatedReportStatus(input);

        expect(mockConsolidatedReportService.updateConsolidatedReportStatus).toHaveBeenCalledWith(input);
      });

      it('should update to IN_PROGRESS status', async () => {
        const input = {
          fileServerId: 'test-fs',
          status: 'IN_PROGRESS' as const,
        };
        mockConsolidatedReportService.updateConsolidatedReportStatus.mockResolvedValue(undefined);

        await service.updateConsolidatedReportStatus(input);

        expect(mockConsolidatedReportService.updateConsolidatedReportStatus).toHaveBeenCalledWith(input);
      });

      it('should log status update with fileServerId', async () => {
        const input = {
          fileServerId: 'test-fs',
          status: 'COMPLETED' as const,
          reportPath: '/path/to/report.pdf',
        };
        mockConsolidatedReportService.updateConsolidatedReportStatus.mockResolvedValue(undefined);

        await service.updateConsolidatedReportStatus(input);

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('Starting updateConsolidatedReportStatus for fileServerId: test-fs, status: COMPLETED')
        );
        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('Completed updateConsolidatedReportStatus for fileServerId: test-fs')
        );
      });

      it('should handle error with error message', async () => {
        const input = {
          fileServerId: 'test-fs',
          status: 'FAILED' as const,
          errorMessage: 'PDF generation timeout',
        };
        const error = new Error('Status update failed');
        mockConsolidatedReportService.updateConsolidatedReportStatus.mockRejectedValue(error);

        await expect(service.updateConsolidatedReportStatus(input)).rejects.toThrow();

        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('Error in updateConsolidatedReportStatus for fileServerId: test-fs'),
          expect.anything()
        );
      });

      it('should handle error without stack trace', async () => {
        const input = {
          fileServerId: 'test-fs',
          status: 'COMPLETED' as const,
          reportPath: '/path/to/report.pdf',
        };
        const error = new Error('Status update failed');
        delete error.stack; // Remove stack property
        mockConsolidatedReportService.updateConsolidatedReportStatus.mockRejectedValue(error);

        await expect(service.updateConsolidatedReportStatus(input)).rejects.toThrow();

        expect(mockLogger.error).toHaveBeenCalled();
      });
    });
  });
});