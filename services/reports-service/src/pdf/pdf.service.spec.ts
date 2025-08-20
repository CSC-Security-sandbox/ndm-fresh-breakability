import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { PdfService } from './pdf.service';
import { InventoryEntity } from '../entities/inventory.entity';
import { ReportsEntity } from '../entities/reports.entity';
import { DiscoveryService } from '../discovery/discovery.service';
import { PDFGeneratorService } from '../generator/pdf-generator.service';
import { PDFTemplate } from '../generator/pdf-generator.type';
import { ReportType } from '../constants/enums';

jest.mock('fs');
jest.mock('path');

describe('PdfService', () => {
  let service: PdfService;
  let inventoryRepo: jest.Mocked<Repository<InventoryEntity>>;
  let reportsRepo: jest.Mocked<Repository<ReportsEntity>>;
  let discoveryService: jest.Mocked<DiscoveryService>;
  let pdfGeneratorService: jest.Mocked<PDFGeneratorService>;

  const mockJobRunId = 'test-job-run-id-123';
  const mockReportData = {
    summary: [{
      source: { job_type: 'SYNC' },
      files_count: 100,
      total_size: 1024
    }],
    last_iteration: {},
    last_errors: {}
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PdfService,
        {
          provide: getRepositoryToken(InventoryEntity),
          useValue: {
            query: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(ReportsEntity),
          useValue: {
            query: jest.fn(),
          },
        },
        {
          provide: DiscoveryService,
          useValue: {
            createJobsPDFReportData: jest.fn(),
          },
        },
        {
          provide: PDFGeneratorService,
          useValue: {
            generatePDF: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PdfService>(PdfService);
    inventoryRepo = module.get(getRepositoryToken(InventoryEntity));
    reportsRepo = module.get(getRepositoryToken(ReportsEntity));
    discoveryService = module.get(DiscoveryService);
    pdfGeneratorService = module.get(PDFGeneratorService);

    jest.spyOn(service['logger'], 'log').mockImplementation();
    jest.spyOn(service['logger'], 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    delete process.env.REPORT_DOWNLOAD_LOCATION;
    delete process.env.SCHEMA;
  });

  describe('generatePdf', () => {
    beforeEach(() => {
      process.env.REPORT_DOWNLOAD_LOCATION = './test-reports';
      (path.join as jest.Mock).mockImplementation((...args) => args.join('/'));
      (path.resolve as jest.Mock).mockImplementation((dir) => `/resolved/${dir}`);
    });

    it('should generate jobs report PDF when reportType is JOBS_RREPORT', async () => {
      const mockBuffer = Buffer.from('mock-pdf-data');
      jest.spyOn(service, 'generateJobsReportPdf').mockResolvedValue(mockBuffer);

      const result = await service.generatePdf(mockJobRunId, ReportType.JOBS_RREPORT);

      expect(result).toBe(mockBuffer);
      expect(service.generateJobsReportPdf).toHaveBeenCalledWith(mockJobRunId);
      expect(service['logger'].log).toHaveBeenCalledWith(
        `Checking for existing report for jobRunId: ${mockJobRunId} and reportType: ${ReportType.JOBS_RREPORT}`
      );
    });

    it('should return existing file for DISCOVERY report when file exists', async () => {
      const mockFileContent = Buffer.from('existing-pdf-content');
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(mockFileContent);
      (path.join as jest.Mock).mockReturnValue('./test-reports/test-job-run-id-123-discovery-report.pdf');
      (path.resolve as jest.Mock).mockReturnValue('/resolved/test-reports');

      const result = await service.generatePdf(mockJobRunId, ReportType.DISCOVERY);

      expect(result).toBe(mockFileContent);
      expect(fs.existsSync).toHaveBeenCalled();
      expect(fs.readFileSync).toHaveBeenCalled();
      expect(service['logger'].log).toHaveBeenCalledWith(
        expect.stringContaining('Report found. Returning existing report:')
      );
    });

    it('should throw BAD_REQUEST for invalid file paths (directory traversal)', async () => {
      const maliciousJobRunId = '../../../etc/passwd';
      (path.join as jest.Mock).mockReturnValue('../../../etc/passwd-discovery-report.pdf');
      (path.resolve as jest.Mock).mockReturnValue('/resolved/test-reports');

      await expect(
        service.generatePdf(maliciousJobRunId, ReportType.DISCOVERY)
      ).rejects.toThrow(new HttpException('Invalid file path', HttpStatus.BAD_REQUEST));

      expect(service['logger'].error).toHaveBeenCalledWith(
        expect.stringContaining('Invalid file path:')
      );
    });

    it('should throw INTERNAL_SERVER_ERROR when DISCOVERY file does not exist', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (path.join as jest.Mock).mockReturnValue('./test-reports/test-job-run-id-123-discovery-report.pdf');
      (path.resolve as jest.Mock).mockReturnValue('/resolved/test-reports');

      await expect(
        service.generatePdf(mockJobRunId, ReportType.DISCOVERY)
      ).rejects.toThrow(
        new HttpException('Report not found, try again later', HttpStatus.INTERNAL_SERVER_ERROR)
      );
    });

    it('should sanitize filename with special characters', async () => {
      const unsafeJobRunId = 'job@#$%^&*()run!@#id';
      const unsafeReportType = 'SOME_REPORT_TYPE!@#$%^&*()';
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(Buffer.from('test'));
      (path.join as jest.Mock).mockImplementation((dir, file) => `${dir}/${file}`);
      (path.resolve as jest.Mock).mockReturnValue('/resolved/test-reports');

      await service.generatePdf(unsafeJobRunId, unsafeReportType as ReportType);

      expect(path.join).toHaveBeenCalledWith(
        './test-reports',
        expect.stringMatching(/^jobrunid-some_report_type-report\.pdf$/)
      );
    });

    it('should use default reports directory when REPORT_DOWNLOAD_LOCATION is not set', async () => {
      delete process.env.REPORT_DOWNLOAD_LOCATION;
      
      // Create new service instance to test constructor
      const moduleWithoutEnv: TestingModule = await Test.createTestingModule({
        providers: [
          PdfService,
          {
            provide: getRepositoryToken(InventoryEntity),
            useValue: { query: jest.fn() },
          },
          {
            provide: getRepositoryToken(ReportsEntity),
            useValue: { query: jest.fn() },
          },
          {
            provide: DiscoveryService,
            useValue: { createJobsPDFReportData: jest.fn() },
          },
          {
            provide: PDFGeneratorService,
            useValue: { generatePDF: jest.fn() },
          },
        ],
      }).compile();

      const serviceWithoutEnv = moduleWithoutEnv.get<PdfService>(PdfService);
      expect(serviceWithoutEnv['reportsDirectory']).toBe('./reports');
    });

    it('should handle edge case with empty jobRunId', async () => {
      const emptyJobRunId = '';
      jest.spyOn(service, 'generateJobsReportPdf').mockResolvedValue(Buffer.from('test'));

      await service.generatePdf(emptyJobRunId, ReportType.JOBS_RREPORT);

      expect(service.generateJobsReportPdf).toHaveBeenCalledWith('');
    });

    it('should handle reportType case sensitivity', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(Buffer.from('test'));
      (path.join as jest.Mock).mockReturnValue('./test-reports/test-discovery-report.pdf');
      (path.resolve as jest.Mock).mockReturnValue('/resolved/test-reports');

      await service.generatePdf(mockJobRunId, 'DISCOVERY' as ReportType);

      expect(path.join).toHaveBeenCalledWith(
        './test-reports',
        expect.stringContaining('-discovery-report.pdf')
      );
    });
  });

  describe('generateJobsReportPdf', () => {
    const mockProjectData = [{ project_name: 'Test Project' }];
    const mockReportsData = [{
      report_data: JSON.stringify(mockReportData)
    }];

    beforeEach(() => {
      inventoryRepo.query.mockResolvedValue(mockProjectData);
      reportsRepo.query.mockResolvedValue(mockReportsData);
      pdfGeneratorService.generatePDF.mockResolvedValue(Buffer.from('generated-pdf'));
    });

    it('should successfully generate jobs report PDF', async () => {
      const expectedPdfBuffer = Buffer.from('generated-pdf');

      const result = await service.generateJobsReportPdf(mockJobRunId);

      expect(result).toBe(expectedPdfBuffer);
      expect(inventoryRepo.query).toHaveBeenCalledWith(
        expect.stringContaining('select p.* from datamigrator.jobrun'),
        [mockJobRunId]
      );
      expect(reportsRepo.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM datamigrator.reports'),
        [mockJobRunId, 'JOBS_REPORT']
      );
      expect(pdfGeneratorService.generatePDF).toHaveBeenCalledWith({
        data: expect.objectContaining({
          customerInfo: {
            projectName: 'Test Project',
            reportDate: expect.any(String)
          },
          cutovers: expect.any(Array),
          last_iteration: expect.objectContaining({
            summary: expect.any(Object)
          }),
          last_errors: expect.objectContaining({
            summary: expect.any(Object)
          })
        }),
        template: PDFTemplate.JOBS_REPORT,
        pdfOptions: {
          format: 'A0',
          printBackground: true,
          scale: 0.5,
          landscape: true
        }
      });
    });

    it('should handle empty project data gracefully', async () => {
      inventoryRepo.query.mockResolvedValue([]);

      await service.generateJobsReportPdf(mockJobRunId);

      expect(pdfGeneratorService.generatePDF).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerInfo: {
              projectName: 'NetApp Data Migrator',
              reportDate: expect.any(String)
            }
          })
        })
      );
    });

    it('should call discovery service and throw error when no report data found', async () => {
      reportsRepo.query.mockResolvedValue([]);

      await expect(service.generateJobsReportPdf(mockJobRunId)).rejects.toThrow(
        new HttpException('Report data not found', HttpStatus.INTERNAL_SERVER_ERROR)
      );

      expect(discoveryService.createJobsPDFReportData).toHaveBeenCalledWith(mockJobRunId);
      expect(service['logger'].error).toHaveBeenCalledWith(
        `Report data not found for jobRunId: ${mockJobRunId} and reportType: JOBS_REPORT`
      );
      expect(service['logger'].log).toHaveBeenCalledWith(
        `Calling discoveryService.createJobsPDFReportData for jobRunId: ${mockJobRunId}`
      );
      expect(service['logger'].log).toHaveBeenCalledWith(
        `Called discoveryService.createJobsPDFReportData for jobRunId: ${mockJobRunId}, try again later`
      );
    });

    it('should throw error for empty summary array', async () => {
      const invalidReportData = { summary: [] };
      reportsRepo.query.mockResolvedValue([{
        report_data: JSON.stringify(invalidReportData)
      }]);

      await expect(service.generateJobsReportPdf(mockJobRunId)).rejects.toThrow(
        new HttpException('Failed to generate jobs report', HttpStatus.INTERNAL_SERVER_ERROR)
      );

      expect(service['logger'].error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to generate jobs report')
      );
    });

    it('should throw error for non-array summary', async () => {
      const invalidReportData = { summary: 'not-an-array' };
      reportsRepo.query.mockResolvedValue([{
        report_data: JSON.stringify(invalidReportData)
      }]);

      await expect(service.generateJobsReportPdf(mockJobRunId)).rejects.toThrow(
        new HttpException('Failed to generate jobs report', HttpStatus.INTERNAL_SERVER_ERROR)
      );
    });

    it('should throw error for missing summary', async () => {
      const invalidReportData = {};
      reportsRepo.query.mockResolvedValue([{
        report_data: JSON.stringify(invalidReportData)
      }]);

      await expect(service.generateJobsReportPdf(mockJobRunId)).rejects.toThrow(
        new HttpException('Failed to generate jobs report', HttpStatus.INTERNAL_SERVER_ERROR)
      );
    });

    it('should filter cutovers correctly', async () => {
      const reportDataWithCutovers = {
        summary: [
          { source: { job_type: 'SYNC' } },
          { source: { job_type: 'CUT_OVER' } },
          { source: { job_type: 'VERIFY' } },
          { source: { job_type: 'CUT_OVER' } }
        ]
      };
      reportsRepo.query.mockResolvedValue([{
        report_data: JSON.stringify(reportDataWithCutovers)
      }]);

      await service.generateJobsReportPdf(mockJobRunId);

      const pdfCall = pdfGeneratorService.generatePDF.mock.calls[0][0];
      expect(pdfCall.data.cutovers).toHaveLength(2);
      expect(pdfCall.data.cutovers.every(item => item.source.job_type === 'CUT_OVER')).toBe(true);
    });

    it('should handle null cutovers filter result', async () => {
      const reportDataWithNullFilter = {
        summary: [{ source: { job_type: 'SYNC' } }]
      };
      reportsRepo.query.mockResolvedValue([{
        report_data: JSON.stringify(reportDataWithNullFilter)
      }]);

      await service.generateJobsReportPdf(mockJobRunId);

      const pdfCall = pdfGeneratorService.generatePDF.mock.calls[0][0];
      expect(pdfCall.data.cutovers).toEqual([]);
    });

    it('should handle inventory database query errors', async () => {
      inventoryRepo.query.mockRejectedValue(new Error('Database connection failed'));

      await expect(service.generateJobsReportPdf(mockJobRunId)).rejects.toThrow(
        new HttpException('Failed to generate jobs report', HttpStatus.INTERNAL_SERVER_ERROR)
      );

      expect(service['logger'].error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to generate jobs report')
      );
    });

    it('should handle reports database query errors', async () => {
      reportsRepo.query.mockRejectedValue(new Error('Reports query failed'));

      await expect(service.generateJobsReportPdf(mockJobRunId)).rejects.toThrow(
        new HttpException('Failed to generate jobs report', HttpStatus.INTERNAL_SERVER_ERROR)
      );
    });

    it('should handle PDF generation errors', async () => {
      pdfGeneratorService.generatePDF.mockRejectedValue(new Error('PDF generation failed'));

      await expect(service.generateJobsReportPdf(mockJobRunId)).rejects.toThrow(
        new HttpException('Failed to generate jobs report', HttpStatus.INTERNAL_SERVER_ERROR)
      );
    });

    it('should handle JSON parsing errors', async () => {
      reportsRepo.query.mockResolvedValue([{
        report_data: 'invalid-json'
      }]);

      await expect(service.generateJobsReportPdf(mockJobRunId)).rejects.toThrow(
        new HttpException('Failed to generate jobs report', HttpStatus.INTERNAL_SERVER_ERROR)
      );
    });

    it('should use custom schema from environment variable', async () => {
      process.env.SCHEMA = 'custom_schema';

      await service.generateJobsReportPdf(mockJobRunId);

      expect(inventoryRepo.query).toHaveBeenCalledWith(
        expect.stringContaining('custom_schema.jobrun'),
        [mockJobRunId]
      );
      expect(reportsRepo.query).toHaveBeenCalledWith(
        expect.stringContaining('custom_schema.reports'),
        [mockJobRunId, 'JOBS_REPORT']
      );
    });

    it('should set last_iteration and last_errors when they are undefined', async () => {
      const reportDataWithoutIterations = {
        summary: [{ source: { job_type: 'SYNC' } }]
      };
      reportsRepo.query.mockResolvedValue([{
        report_data: JSON.stringify(reportDataWithoutIterations)
      }]);

      await service.generateJobsReportPdf(mockJobRunId);

      const pdfCall = pdfGeneratorService.generatePDF.mock.calls[0][0];
      expect(pdfCall.data.last_iteration).toEqual({
        summary: { source: { job_type: 'SYNC' } }
      });
      expect(pdfCall.data.last_errors).toEqual({
        summary: { source: { job_type: 'SYNC' } }
      });
    });

    it('should preserve existing last_iteration and last_errors', async () => {
      const reportDataWithExistingData = {
        summary: [{ source: { job_type: 'SYNC' } }],
        last_iteration: { existing: 'data' },
        last_errors: { error: 'data' }
      };
      reportsRepo.query.mockResolvedValue([{
        report_data: JSON.stringify(reportDataWithExistingData)
      }]);

      await service.generateJobsReportPdf(mockJobRunId);

      const pdfCall = pdfGeneratorService.generatePDF.mock.calls[0][0];
      expect(pdfCall.data.last_iteration).toEqual({
        existing: 'data',
        summary: { source: { job_type: 'SYNC' } }
      });
      expect(pdfCall.data.last_errors).toEqual({
        error: 'data',
        summary: { source: { job_type: 'SYNC' } }
      });
    });

    it('should handle null project data', async () => {
      inventoryRepo.query.mockResolvedValue(null);

      await expect(service.generateJobsReportPdf(mockJobRunId)).rejects.toThrow(
        new HttpException('Failed to generate jobs report', HttpStatus.INTERNAL_SERVER_ERROR)
      );
    });

    it('should handle complex report data structure', async () => {
      const complexReportData = {
        summary: [
          { source: { job_type: 'SYNC' }, files: 100 },
          { source: { job_type: 'CUT_OVER' }, files: 50 },
          { source: { job_type: 'VERIFY' }, files: 75 }
        ],
        last_iteration: { iteration: 5 },
        last_errors: { errors: ['error1', 'error2'] }
      };
      reportsRepo.query.mockResolvedValue([{
        report_data: JSON.stringify(complexReportData)
      }]);

      const result = await service.generateJobsReportPdf(mockJobRunId);

      expect(result).toEqual(Buffer.from('generated-pdf'));
      const pdfCall = pdfGeneratorService.generatePDF.mock.calls[0][0];
      expect(pdfCall.data.cutovers).toHaveLength(1);
      expect(pdfCall.data.last_iteration.iteration).toBe(5);
      expect(pdfCall.data.last_errors.errors).toEqual(['error1', 'error2']);
    });

    it('should generate correct report date', async () => {
      const mockDate = new Date('2023-12-25');
      jest.spyOn(global, 'Date').mockImplementation(() => mockDate as any);

      await service.generateJobsReportPdf(mockJobRunId);

      const pdfCall = pdfGeneratorService.generatePDF.mock.calls[0][0];
      expect(pdfCall.data.customerInfo.reportDate).toBe('12/25/2023');
    });
  });
});