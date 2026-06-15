import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { TemporalClientService } from 'src/temporal/temporal-client.service';
import { ConsolidatedReportService } from 'src/activities/consolidated-report/consolidated-report.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { JwtAuthGuard, JwtService } from '@netapp-cloud-datamigrate/auth-lib';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import * as fs from 'fs';

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
    let mockRes: any;
    let mockStream: any;

    beforeEach(() => {
      mockStream = {
        pipe: jest.fn(),
        on: jest.fn().mockReturnThis(),
        destroy: jest.fn(),
      };
      mockRes = {
        set: jest.fn(),
        on: jest.fn(),
        headersSent: false,
        status: jest.fn().mockReturnThis(),
        end: jest.fn(),
      };
      jest.spyOn(fs, 'createReadStream').mockReturnValue(mockStream as any);
      jest.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1024 } as any);
    });

    it('should stream report file to response', async () => {
      const fileServerId = 'test-file-server-123';
      const reportPath = '/path/to/report.pdf';

      consolidatedReportService.getReportFilePath.mockResolvedValue(reportPath);

      await controller.downloadConsolidatedReport(fileServerId, mockRes);

      expect(consolidatedReportService.getReportFilePath).toHaveBeenCalledWith(fileServerId);
      expect(mockRes.set).toHaveBeenCalledWith(expect.objectContaining({
        'Content-Type': 'application/pdf',
      }));
      expect(mockStream.pipe).toHaveBeenCalledWith(mockRes);
    });

    it('should throw NotFoundException when report not found', async () => {
      const fileServerId = 'unknown-file-server';
      consolidatedReportService.getReportFilePath.mockResolvedValue(null);

      await expect(
        controller.downloadConsolidatedReport(fileServerId, mockRes)
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when fileServerId is missing', async () => {
      await expect(
        controller.downloadConsolidatedReport('', mockRes)
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when fileServerId is null', async () => {
      await expect(
        controller.downloadConsolidatedReport(null as any, mockRes)
      ).rejects.toThrow(BadRequestException);
    });

    it('should clear status on response finish', async () => {
      const fileServerId = 'test-file-server-123';
      const reportPath = '/path/to/report.pdf';

      consolidatedReportService.getReportFilePath.mockResolvedValue(reportPath);
      consolidatedReportService.clearStatus.mockResolvedValue(undefined);

      let finishHandler: () => void;
      mockRes.on.mockImplementation((event: string, cb: any) => {
        if (event === 'finish') finishHandler = cb;
      });

      await controller.downloadConsolidatedReport(fileServerId, mockRes);
      await finishHandler!();

      expect(consolidatedReportService.clearStatus).toHaveBeenCalledWith(fileServerId);
    });

    it('should handle large files via streaming', async () => {
      const fileServerId = 'test-file-server-123';
      const reportPath = '/path/to/large-report.pdf';

      consolidatedReportService.getReportFilePath.mockResolvedValue(reportPath);
      jest.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 10 * 1024 * 1024 } as any);

      await controller.downloadConsolidatedReport(fileServerId, mockRes);

      expect(mockStream.pipe).toHaveBeenCalledWith(mockRes);
    });

    it('should set correct content type for CSV download', async () => {
      const fileServerId = 'test-file-server-123';
      const reportPath = '/path/to/report.csv';

      consolidatedReportService.getReportFilePath.mockResolvedValue(reportPath);

      await controller.downloadConsolidatedReport(fileServerId, mockRes);

      expect(mockRes.set).toHaveBeenCalledWith(expect.objectContaining({
        'Content-Type': 'text/csv',
      }));
    });

    it('should throw NotFoundException when stat fails', async () => {
      const fileServerId = 'test-file-server-123';
      const reportPath = '/path/to/report.pdf';

      consolidatedReportService.getReportFilePath.mockResolvedValue(reportPath);
      jest.spyOn(fs.promises, 'stat').mockRejectedValue(new Error('File not found'));

      await expect(
        controller.downloadConsolidatedReport(fileServerId, mockRes)
      ).rejects.toThrow(NotFoundException);
    });

    it('should log download request', async () => {
      const fileServerId = 'test-file-server-123';
      const reportPath = '/path/to/report.pdf';

      consolidatedReportService.getReportFilePath.mockResolvedValue(reportPath);

      await controller.downloadConsolidatedReport(fileServerId, mockRes);

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining(fileServerId)
      );
    });

    it('should not clear status before stream finishes', async () => {
      const fileServerId = 'test-file-server-123';
      const reportPath = '/path/to/report.pdf';

      consolidatedReportService.getReportFilePath.mockResolvedValue(reportPath);

      await controller.downloadConsolidatedReport(fileServerId, mockRes);

      expect(consolidatedReportService.clearStatus).not.toHaveBeenCalled();
    });

    it('should handle report path retrieval errors', async () => {
      const fileServerId = 'test-file-server-123';

      consolidatedReportService.getReportFilePath.mockRejectedValue(new Error('Database error'));

      await expect(
        controller.downloadConsolidatedReport(fileServerId, mockRes)
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
      const mockStream = { pipe: jest.fn(), on: jest.fn().mockReturnThis(), destroy: jest.fn() };
      const mockRes1: any = { set: jest.fn(), on: jest.fn(), headersSent: false, status: jest.fn().mockReturnThis(), end: jest.fn() };
      const mockRes2: any = { set: jest.fn(), on: jest.fn(), headersSent: false, status: jest.fn().mockReturnThis(), end: jest.fn() };

      consolidatedReportService.getReportFilePath.mockResolvedValue(reportPath);
      jest.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1024 } as any);
      jest.spyOn(fs, 'createReadStream').mockReturnValue(mockStream as any);

      const result1 = controller.downloadConsolidatedReport(fileServerId, mockRes1);
      const result2 = controller.downloadConsolidatedReport(fileServerId, mockRes2);

      await Promise.all([result1, result2]);

      expect(consolidatedReportService.getReportFilePath).toHaveBeenCalledTimes(2);
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
