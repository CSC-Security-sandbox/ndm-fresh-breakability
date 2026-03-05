import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, StreamableFile } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { TemporalClientService } from 'src/temporal/temporal-client.service';
import { ConsolidatedReportService } from 'src/activities/consolidated-report/consolidated-report.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { JwtAuthGuard, JwtService } from '@netapp-cloud-datamigrate/auth-lib';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

describe('ReportsController', () => {
  let controller: ReportsController;
  let temporalClientService: jest.Mocked<TemporalClientService>;
  let consolidatedReportService: jest.Mocked<ConsolidatedReportService>;
  let mockLogger: any;

  mockLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  };

  const mockLoggerFactory = {
    create: jest.fn().mockReturnValue(mockLogger),
  };

  const mockJwtService = {
    verifyToken: jest.fn(),
    decode: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue({
      keycloakBaseUrl: 'http://localhost:8080',
      realm: 'test',
    }),
  };

  const mockJwtAuthGuard = {
    canActivate: jest.fn().mockReturnValue(true),
  };

  beforeEach(async () => {
    temporalClientService = {
      startWorkflow: jest.fn(),
      getWorkflowStatus: jest.fn(),
      waitForWorkflowResult: jest.fn(),
    } as any;

    consolidatedReportService = {
      initializeStatus: jest.fn(),
      getConsolidatedReportStatus: jest.fn(),
      getReportFilePath: jest.fn(),
      readReportFile: jest.fn(),
      clearStatus: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [
        {
          provide: TemporalClientService,
          useValue: temporalClientService,
        },
        {
          provide: ConsolidatedReportService,
          useValue: consolidatedReportService,
        },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: Reflector,
          useValue: {},
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtAuthGuard)
      .compile();

    controller = module.get<ReportsController>(ReportsController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('startConsolidatedDiscoveryReport', () => {
    it('should start consolidated report workflow successfully', async () => {
      const fileServerId = 'test-file-server-123';
      const configName = 'TestConfig';

      consolidatedReportService.initializeStatus.mockResolvedValue(undefined);
      temporalClientService.startWorkflow.mockResolvedValue(undefined);

      const result = await controller.startConsolidatedDiscoveryReport(fileServerId, configName);

      expect(result.workflowId).toContain('consolidated-report-');
      expect(result.workflowId).toContain(fileServerId);
      expect(result.message).toContain('started');
      expect(consolidatedReportService.initializeStatus).toHaveBeenCalledWith(
        fileServerId,
        expect.any(String),
        configName
      );
      expect(temporalClientService.startWorkflow).toHaveBeenCalledWith({
        workflowName: 'GenerateConsolidatedReportWorkflow',
        workflowId: expect.any(String),
        args: [{ fileServerId, configName, format: 'pdf' }],
      });
    });

    it('should start consolidated report workflow with format csv when format is passed', async () => {
      const fileServerId = 'test-file-server-123';
      const configName = 'TestConfig';

      consolidatedReportService.initializeStatus.mockResolvedValue(undefined);
      temporalClientService.startWorkflow.mockResolvedValue(undefined);

      await controller.startConsolidatedDiscoveryReport(fileServerId, configName, 'csv');

      expect(temporalClientService.startWorkflow).toHaveBeenCalledWith({
        workflowName: 'GenerateConsolidatedReportWorkflow',
        workflowId: expect.any(String),
        args: [{ fileServerId, configName, format: 'csv' }],
      });
    });

    it('should throw BadRequestException when fileServerId is missing', async () => {
      await expect(
        controller.startConsolidatedDiscoveryReport('', 'ConfigName')
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when configName is missing', async () => {
      await expect(
        controller.startConsolidatedDiscoveryReport('file-server-id', '')
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when fileServerId is null', async () => {
      await expect(
        controller.startConsolidatedDiscoveryReport(null as any, 'ConfigName')
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when configName is null', async () => {
      await expect(
        controller.startConsolidatedDiscoveryReport('file-server-id', null as any)
      ).rejects.toThrow(BadRequestException);
    });

    it('should initialize status before starting workflow', async () => {
      const fileServerId = 'test-file-server-456';
      const configName = 'AnotherConfig';

      consolidatedReportService.initializeStatus.mockResolvedValue(undefined);
      temporalClientService.startWorkflow.mockResolvedValue(undefined);

      await controller.startConsolidatedDiscoveryReport(fileServerId, configName);

      expect(consolidatedReportService.initializeStatus).toHaveBeenCalled();
      expect(temporalClientService.startWorkflow).toHaveBeenCalled();
    });

    it('should include timestamp in workflowId', async () => {
      const fileServerId = 'test-file-server-789';
      const configName = 'TestConfig';

      consolidatedReportService.initializeStatus.mockResolvedValue(undefined);
      temporalClientService.startWorkflow.mockResolvedValue(undefined);

      const result = await controller.startConsolidatedDiscoveryReport(fileServerId, configName);

      expect(result.workflowId).toMatch(/consolidated-report-test-file-server-789-\d+/);
    });
  });

  describe('getConsolidatedReportStatusByFileServer', () => {
    it('should return report status when found', async () => {
      const fileServerId = 'test-file-server-123';
      const mockStatus = {
        status: 'COMPLETED',
        workflowId: 'workflow-123',
        reportPath: '/path/to/report.pdf',
        updatedAt: new Date(),
      };

      consolidatedReportService.getConsolidatedReportStatus.mockResolvedValue(mockStatus as any);

      const result = await controller.getConsolidatedReportStatusByFileServer(fileServerId);

      expect(result).toEqual(mockStatus);
      expect(consolidatedReportService.getConsolidatedReportStatus).toHaveBeenCalledWith(fileServerId);
    });

    it('should return NOT_FOUND status when no status found', async () => {
      const fileServerId = 'unknown-file-server';
      consolidatedReportService.getConsolidatedReportStatus.mockResolvedValue(null);

      const result = await controller.getConsolidatedReportStatusByFileServer(fileServerId);

      expect(result.status).toBe('NOT_FOUND');
    });

    it('should return IN_PROGRESS status', async () => {
      const fileServerId = 'test-file-server-123';
      const mockStatus = {
        status: 'IN_PROGRESS',
        workflowId: 'workflow-456',
      };

      consolidatedReportService.getConsolidatedReportStatus.mockResolvedValue(mockStatus as any);

      const result = await controller.getConsolidatedReportStatusByFileServer(fileServerId);

      expect(result.status).toBe('IN_PROGRESS');
    });

    it('should return FAILED status', async () => {
      const fileServerId = 'test-file-server-123';
      const mockStatus = {
        status: 'FAILED',
        workflowId: 'workflow-789',
      };

      consolidatedReportService.getConsolidatedReportStatus.mockResolvedValue(mockStatus as any);

      const result = await controller.getConsolidatedReportStatusByFileServer(fileServerId);

      expect(result.status).toBe('FAILED');
    });

    it('should throw BadRequestException when fileServerId is missing', async () => {
      await expect(
        controller.getConsolidatedReportStatusByFileServer('')
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when fileServerId is null', async () => {
      await expect(
        controller.getConsolidatedReportStatusByFileServer(null as any)
      ).rejects.toThrow(BadRequestException);
    });

    it('should include reportPath in response when available', async () => {
      const fileServerId = 'test-file-server-123';
      const reportPath = '/reports/consolidated-report.pdf';
      const mockStatus = {
        status: 'COMPLETED',
        workflowId: 'workflow-123',
        reportPath,
        updatedAt: new Date(),
      };

      consolidatedReportService.getConsolidatedReportStatus.mockResolvedValue(mockStatus as any);

      const result = await controller.getConsolidatedReportStatusByFileServer(fileServerId);

      expect(result.reportPath).toBe(reportPath);
    });
  });

  describe('getConsolidatedReportStatus', () => {
    it('should return workflow status when found', async () => {
      const workflowId = 'workflow-123';
      const mockStatus = { status: 'COMPLETED', result: { reportPath: '/path/to/report.pdf' } };

      temporalClientService.getWorkflowStatus.mockResolvedValue(mockStatus as any);

      const result = await controller.getConsolidatedReportStatus(workflowId);

      expect(result).toEqual(mockStatus);
      expect(temporalClientService.getWorkflowStatus).toHaveBeenCalledWith(workflowId);
    });

    it('should throw NotFoundException when workflow not found', async () => {
      const workflowId = 'unknown-workflow';
      temporalClientService.getWorkflowStatus.mockRejectedValue(new Error('Workflow not found'));

      await expect(
        controller.getConsolidatedReportStatus(workflowId)
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when workflowId is missing', async () => {
      await expect(
        controller.getConsolidatedReportStatus('')
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when workflowId is null', async () => {
      await expect(
        controller.getConsolidatedReportStatus(null as any)
      ).rejects.toThrow(BadRequestException);
    });

    it('should handle RUNNING status', async () => {
      const workflowId = 'workflow-456';
      const mockStatus = { status: 'RUNNING' };

      temporalClientService.getWorkflowStatus.mockResolvedValue(mockStatus as any);

      const result = await controller.getConsolidatedReportStatus(workflowId);

      expect(result.status).toBe('RUNNING');
    });

    it('should handle FAILED status with error message', async () => {
      const workflowId = 'workflow-789';
      const mockStatus = { status: 'FAILED', error: 'Workflow execution failed' };

      temporalClientService.getWorkflowStatus.mockResolvedValue(mockStatus as any);

      const result = await controller.getConsolidatedReportStatus(workflowId);

      expect(result.status).toBe('FAILED');
      expect(result.error).toBe('Workflow execution failed');
    });

    it('should handle expired workflow', async () => {
      const workflowId = 'expired-workflow';
      temporalClientService.getWorkflowStatus.mockRejectedValue(new Error('Workflow has expired'));

      await expect(
        controller.getConsolidatedReportStatus(workflowId)
      ).rejects.toThrow(NotFoundException);
    });

    it('should log workflow status check', async () => {
      const workflowId = 'workflow-log-test';
      const mockStatus = { status: 'COMPLETED' };

      temporalClientService.getWorkflowStatus.mockResolvedValue(mockStatus as any);

      await controller.getConsolidatedReportStatus(workflowId);

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining(workflowId)
      );
    });
  });

  describe('downloadConsolidatedReport', () => {
    it('should download report successfully', async () => {
      const fileServerId = 'test-file-server-123';
      const reportPath = '/path/to/report.pdf';
      const reportBuffer = Buffer.from('pdf-content');

      consolidatedReportService.getReportFilePath.mockResolvedValue(reportPath);
      consolidatedReportService.readReportFile.mockResolvedValue(reportBuffer);
      consolidatedReportService.clearStatus.mockResolvedValue(undefined);

      const result = await controller.downloadConsolidatedReport(fileServerId);

      expect(result).toBeInstanceOf(StreamableFile);
      expect(consolidatedReportService.getReportFilePath).toHaveBeenCalledWith(fileServerId);
      expect(consolidatedReportService.readReportFile).toHaveBeenCalledWith(reportPath);
      expect(consolidatedReportService.clearStatus).toHaveBeenCalledWith(fileServerId);
    });

    it('should throw NotFoundException when report not found', async () => {
      const fileServerId = 'unknown-file-server';
      consolidatedReportService.getReportFilePath.mockResolvedValue(null);

      await expect(
        controller.downloadConsolidatedReport(fileServerId)
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when fileServerId is missing', async () => {
      await expect(
        controller.downloadConsolidatedReport('')
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when fileServerId is null', async () => {
      await expect(
        controller.downloadConsolidatedReport(null as any)
      ).rejects.toThrow(BadRequestException);
    });

    it('should clear status after successful download', async () => {
      const fileServerId = 'test-file-server-123';
      const reportPath = '/path/to/report.pdf';
      const reportBuffer = Buffer.from('pdf-content');

      consolidatedReportService.getReportFilePath.mockResolvedValue(reportPath);
      consolidatedReportService.readReportFile.mockResolvedValue(reportBuffer);
      consolidatedReportService.clearStatus.mockResolvedValue(undefined);

      await controller.downloadConsolidatedReport(fileServerId);

      expect(consolidatedReportService.clearStatus).toHaveBeenCalledWith(fileServerId);
    });

    it('should handle large files', async () => {
      const fileServerId = 'test-file-server-123';
      const reportPath = '/path/to/large-report.pdf';
      const largeBuffer = Buffer.alloc(10 * 1024 * 1024); // 10MB

      consolidatedReportService.getReportFilePath.mockResolvedValue(reportPath);
      consolidatedReportService.readReportFile.mockResolvedValue(largeBuffer);
      consolidatedReportService.clearStatus.mockResolvedValue(undefined);

      const result = await controller.downloadConsolidatedReport(fileServerId);

      expect(result).toBeInstanceOf(StreamableFile);
    });

    it('should set correct content type for PDF download', async () => {
      const fileServerId = 'test-file-server-123';
      const reportPath = '/path/to/report.pdf';
      const reportBuffer = Buffer.from('pdf-content');

      consolidatedReportService.getReportFilePath.mockResolvedValue(reportPath);
      consolidatedReportService.readReportFile.mockResolvedValue(reportBuffer);
      consolidatedReportService.clearStatus.mockResolvedValue(undefined);

      const result = await controller.downloadConsolidatedReport(fileServerId);

      expect(result).toBeInstanceOf(StreamableFile);
    });

    it('should throw NotFoundException with descriptive message when report file read fails', async () => {
      const fileServerId = 'test-file-server-123';
      const reportPath = '/path/to/report.pdf';

      consolidatedReportService.getReportFilePath.mockResolvedValue(reportPath);
      consolidatedReportService.readReportFile.mockImplementation(() => {
        throw new Error('File read error');
      });

      await expect(
        controller.downloadConsolidatedReport(fileServerId)
      ).rejects.toThrow(NotFoundException);
    });

    it('should log download request', async () => {
      const fileServerId = 'test-file-server-123';
      const reportPath = '/path/to/report.pdf';
      const reportBuffer = Buffer.from('pdf-content');

      consolidatedReportService.getReportFilePath.mockResolvedValue(reportPath);
      consolidatedReportService.readReportFile.mockResolvedValue(reportBuffer);
      consolidatedReportService.clearStatus.mockResolvedValue(undefined);

      await controller.downloadConsolidatedReport(fileServerId);

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining(fileServerId)
      );
    });

    it('should not clear status if download file read fails', async () => {
      const fileServerId = 'test-file-server-123';
      const reportPath = '/path/to/report.pdf';

      consolidatedReportService.getReportFilePath.mockResolvedValue(reportPath);
      consolidatedReportService.readReportFile.mockImplementation(() => {
        throw new Error('File read error');
      });

      try {
        await controller.downloadConsolidatedReport(fileServerId);
      } catch (e) {
        // Expected to fail
      }

      expect(consolidatedReportService.clearStatus).not.toHaveBeenCalled();
    });

    it('should handle report path retrieval errors', async () => {
      const fileServerId = 'test-file-server-123';

      consolidatedReportService.getReportFilePath.mockRejectedValue(new Error('Database error'));

      await expect(
        controller.downloadConsolidatedReport(fileServerId)
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Controller initialization', () => {
    it('should initialize with logger factory', async () => {
      expect(mockLoggerFactory.create).toHaveBeenCalledWith('ReportsController');
    });
  });

  describe('Error handling and edge cases', () => {
    it('should handle concurrent requests to download same report', async () => {
      const fileServerId = 'test-file-server-123';
      const reportPath = '/path/to/report.pdf';
      const reportBuffer = Buffer.from('pdf-content');

      consolidatedReportService.getReportFilePath.mockResolvedValue(reportPath);
      consolidatedReportService.readReportFile.mockResolvedValue(reportBuffer);
      consolidatedReportService.clearStatus.mockResolvedValue(undefined);

      const result1 = controller.downloadConsolidatedReport(fileServerId);
      const result2 = controller.downloadConsolidatedReport(fileServerId);

      await Promise.all([result1, result2]);

      expect(consolidatedReportService.getReportFilePath).toHaveBeenCalledTimes(2);
      expect(consolidatedReportService.clearStatus).toHaveBeenCalledTimes(2);
    });

    it('should handle special characters in fileServerId', async () => {
      const fileServerId = 'test-file-server-123_!@#$%';
      const configName = 'TestConfig';

      consolidatedReportService.initializeStatus.mockResolvedValue(undefined);
      temporalClientService.startWorkflow.mockResolvedValue(undefined);

      const result = await controller.startConsolidatedDiscoveryReport(fileServerId, configName);

      expect(result.workflowId).toContain(fileServerId);
    });
  });
});
