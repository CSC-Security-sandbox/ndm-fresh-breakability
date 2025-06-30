import { Test, TestingModule } from '@nestjs/testing';
import { PdfService } from './pdf.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { ReportsEntity } from 'src/entities/reports.entity';
import { DiscoveryService } from '../discovery/discovery.service';
import { ReportType } from 'src/constants/enums';
import * as fs from 'fs';
import * as path from 'path';
import * as hbs from 'hbs';

jest.mock('fs');
jest.mock('hbs');
jest.mock('puppeteer', () => ({
  launch: jest.fn(),
}));

import * as puppeteer from 'puppeteer';

describe('PdfService', () => {
  let service: PdfService;
  let discoveryService: DiscoveryService;
  let inventoryRepo: any;
  let reportsRepo: any;

  const mockJobRunId = 'job-123';
  const mockPdfBuffer = Buffer.from('PDF content');

  beforeEach(async () => {
    inventoryRepo = { query: jest.fn() };
    reportsRepo = { query: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PdfService,
        {
          provide: getRepositoryToken(InventoryEntity),
          useValue: inventoryRepo,
        },
        {
          provide: getRepositoryToken(ReportsEntity),
          useValue: reportsRepo,
        },
        {
          provide: DiscoveryService,
          useValue: {
            createJobsPDFReportData: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PdfService>(PdfService);
    discoveryService = module.get<DiscoveryService>(DiscoveryService);

    process.env.REPORT_DOWNLOAD_LOCATION = './reports';

    jest.spyOn(path, 'join').mockImplementation((...paths: string[]) => path.resolve(...paths));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  describe('generatePdf', () => {
    it('should return existing report if file exists and type is DISCOVERY', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(mockPdfBuffer);

      const result = await service.generatePdf(mockJobRunId, ReportType.DISCOVERY);
      expect(result).toEqual(mockPdfBuffer);
    });

    it('should call generateJobsReportPdf if type is JOBS_REPORT', async () => {
      const spy = jest.spyOn(service, 'generateJobsReportPdf').mockResolvedValue(mockPdfBuffer);

      const result = await service.generatePdf(mockJobRunId, ReportType.JOBS_RREPORT);
      expect(spy).toHaveBeenCalledWith(mockJobRunId);
      expect(result).toEqual(mockPdfBuffer);
    });

    it('should throw if report does not exist and is not JOBS_REPORT', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(service.generatePdf(mockJobRunId, ReportType.DISCOVERY)).rejects.toThrow(
        'Report not found, try again later',
      );
    });

    it('should throw if file path is invalid', async () => {
      const resultService = new PdfService(inventoryRepo, reportsRepo, discoveryService);
      jest.spyOn(path, 'join').mockReturnValue('/etc/passwd');

      await expect(
        resultService.generatePdf(mockJobRunId, ReportType.DISCOVERY),
      ).rejects.toThrow('Invalid file path');
    });
  });

  describe('generateJobsReportPdf', () => {
    it('should generate PDF buffer with valid data', async () => {
      const compileMock = jest.fn().mockReturnValue(() => '<html></html>');
      (hbs.compile as jest.Mock).mockReturnValue(compileMock());

      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify({
            summary: [{ source: { job_type: 'CUT_OVER' } }],
          }),
        },
      ]);

      inventoryRepo.query.mockResolvedValue([
        { project_name: 'Test Project' },
      ]);

      const newPageMock = {
        setContent: jest.fn(),
        pdf: jest.fn().mockResolvedValue(mockPdfBuffer),
      };

      const browserMock = {
        newPage: jest.fn().mockResolvedValue(newPageMock),
        close: jest.fn(),
      };

      (puppeteer.launch as jest.Mock).mockResolvedValue(browserMock);

      const result = await service.generateJobsReportPdf(mockJobRunId);

      expect(result).toEqual(mockPdfBuffer);
      expect(browserMock.newPage).toHaveBeenCalled();
      expect(newPageMock.setContent).toHaveBeenCalled();
    });

    it('should handle missing report data and call discovery service', async () => {
      reportsRepo.query.mockResolvedValue([]);
      const spy = jest.spyOn(discoveryService, 'createJobsPDFReportData');

      await expect(service.generateJobsReportPdf(mockJobRunId)).rejects.toThrow(
        'Failed to generate jobs report',
      );

      expect(spy).toHaveBeenCalledWith(mockJobRunId);
    });

    it('should throw if summary is invalid', async () => {
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify({ summary: [] }),
        },
      ]);
      inventoryRepo.query.mockResolvedValue([]);

      await expect(service.generateJobsReportPdf(mockJobRunId)).rejects.toThrow(
        'Failed to generate jobs report',
      );
    });

    it('should catch and log puppeteer launch error', async () => {
      (hbs.compile as jest.Mock).mockReturnValue(() => '<html></html>');
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify({
            summary: [{ source: { job_type: 'CUT_OVER' } }],
          }),
        },
      ]);
      inventoryRepo.query.mockResolvedValue([]);

      (puppeteer.launch as jest.Mock).mockRejectedValue(new Error('Launch failed'));

      await expect(service.generateJobsReportPdf(mockJobRunId)).rejects.toThrow(
        'Failed to generate jobs report',
      );
    });
  });
});
