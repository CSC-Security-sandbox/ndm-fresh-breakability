import { Test, TestingModule } from '@nestjs/testing';
import { PdfService } from './pdf.service';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ReportsEntity } from 'src/entities/reports.entity';
import { ReportType } from 'src/constants/enums';
import * as fs from 'fs';
import * as path from 'path';
import * as puppeteer from 'puppeteer';
import { Browser, Page } from 'puppeteer';

jest.mock('puppeteer');

describe('PdfService', () => {
  let pdfService: PdfService;
  let mockInventoryRepo;
  let mockReportsRepo;
  let mockBrowser: Partial<Browser>;
  let mockPage: Partial<Page>;

  beforeEach(async () => {
    mockInventoryRepo = {
      query: jest.fn()
    };

    mockReportsRepo = {
      query: jest.fn(),
      find: jest.fn()
    };

    mockPage = {
      setContent: jest.fn().mockResolvedValue(null),
      pdf: jest.fn().mockResolvedValue(Buffer.from('mockPdfBuffer')),
      close: jest.fn().mockResolvedValue(null),
    };

    mockBrowser = {
      newPage: jest.fn().mockResolvedValue(mockPage as Page),
      close: jest.fn().mockResolvedValue(null),
    };

    (puppeteer.launch as jest.Mock).mockResolvedValue(mockBrowser as Browser);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PdfService,
        {
          provide: getRepositoryToken(InventoryEntity),
          useValue: mockInventoryRepo,
        },
        {
          provide: getRepositoryToken(ReportsEntity),
          useValue: mockReportsRepo,
        },
      ],
    }).compile();

    pdfService = module.get<PdfService>(PdfService);
  });

  describe('generatePdf', () => {
    it('should generate and save new PDF if report type is JOBS_RREPORT', async () => {
      const jobRunId = 'test-jobRunId';
      const reportType = ReportType.JOBS_RREPORT;
      const pdfBuffer = Buffer.from('newPdfBuffer');
      const filePath = '/path/to/report.pdf';

      jest.spyOn(path, 'join').mockReturnValue(filePath);
      jest.spyOn(pdfService, 'generateJobsReportPdf').mockResolvedValue(pdfBuffer);
      jest.spyOn(fs, 'writeFileSync').mockImplementation();

      const result = await pdfService.generatePdf(jobRunId, reportType);

      expect(result).toEqual(pdfBuffer);
      expect(pdfService.generateJobsReportPdf).toHaveBeenCalledWith(jobRunId);
      expect(fs.writeFileSync).toHaveBeenCalledWith(filePath, pdfBuffer);
    });
  });

  describe('generateJobsReportPdf', () => {
    it('should generate and return PDF buffer', async () => {
      const jobRunId = 'test-jobRunId';
      const mockReportData = [{ report_data: {} }];
      const mockHtml = '<html></html>';
      const mockPdfBuffer = Buffer.from('mockPdfBuffer');

      jest.spyOn(path, 'join').mockReturnValue('mockPath');
      jest.spyOn(fs, 'readFileSync').mockReturnValue('<html></html>');
      jest.spyOn(mockReportsRepo, 'query').mockResolvedValue(mockReportData);

      const result = await pdfService.generateJobsReportPdf(jobRunId);

      expect(path.join).toHaveBeenCalledWith(__dirname, '../../templates/views/jobs_report.hbs');
      expect(fs.readFileSync).toHaveBeenCalledWith('mockPath', 'utf8');
      expect(puppeteer.launch).toHaveBeenCalled();
      expect(mockBrowser.newPage).toHaveBeenCalled();
      expect(mockPage.setContent).toHaveBeenCalledWith(mockHtml, { waitUntil: 'networkidle0' });
      expect(mockPage.pdf).toHaveBeenCalledWith({ format: 'A4', printBackground: true });
      expect(result).toEqual(mockPdfBuffer);
    });
  });
});

function normalizeHtml(html: string): string {
  return html
    .replace(/\s+/g, ' ') 
    .trim();             
}
