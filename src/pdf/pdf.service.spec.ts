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
import * as hbs from "hbs";

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
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      jest.spyOn(fs, 'writeFileSync').mockImplementation();

      const result = await pdfService.generatePdf(jobRunId, reportType);

      expect(result).toEqual(pdfBuffer);
      expect(pdfService.generateJobsReportPdf).toHaveBeenCalledWith(jobRunId);
    });
    it("should return the existing report if it exists and report type is DISCOVERY", async () => {
      const jobRunId = "test-jobRunId";
      const reportType = ReportType.DISCOVERY;
      const fileName = `${jobRunId}-${reportType.toLowerCase()}-report.pdf`;
      const filePath = `/path/to/${fileName}`;

      jest.spyOn(path, "join").mockReturnValue(filePath);
      jest.spyOn(fs, "existsSync").mockReturnValue(true);
      jest
        .spyOn(fs, "readFileSync")
        .mockReturnValue(Buffer.from("existingReportBuffer"));

      const result = await pdfService.generatePdf(jobRunId, reportType);

      expect(result).toEqual(Buffer.from("existingReportBuffer"));
      expect(fs.existsSync).toHaveBeenCalledWith(filePath);
      expect(fs.readFileSync).toHaveBeenCalledWith(filePath);
    });
  });

  describe("generateJobsReportPdf", () => {
    it("should generate and return a PDF buffer", async () => {
      const jobRunId = "test-jobRunId";
      const mockHtml = "<html></html>";
      const mockPdfBuffer = Buffer.from("mockPdfBuffer");
      const mockReportData = {
        report_data: JSON.stringify({
          summary: [{}],
          last_iteration: {},
          last_errors: {},
        }),
      };

      process.env.SCHEMA = "datamigrator";

      jest.spyOn(path, "join").mockReturnValue("/mock/template/path.hbs");
      jest.spyOn(fs, "readFileSync").mockReturnValue("<html></html>");
      jest.spyOn(hbs, "compile").mockReturnValue(() => mockHtml);
      jest.spyOn(mockReportsRepo, "query").mockResolvedValue([mockReportData]);

      mockPage = {
        setContent: jest.fn().mockResolvedValue(null),
        pdf: jest.fn().mockResolvedValue(mockPdfBuffer),
        close: jest.fn().mockResolvedValue(null),
      };

      mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage as Page),
        close: jest.fn().mockResolvedValue(null),
      };

      (puppeteer.launch as jest.Mock).mockResolvedValue(mockBrowser as Browser);

      const result = await pdfService.generateJobsReportPdf(jobRunId);

      expect(path.join).toHaveBeenCalledWith(
        __dirname,
        "../../templates/views/jobs_report.hbs"
      );
      expect(fs.readFileSync).toHaveBeenCalledWith(
        "/mock/template/path.hbs",
        "utf8"
      );
      expect(hbs.compile).toHaveBeenCalled();
      expect(mockReportsRepo.query).toHaveBeenCalledWith(
        `SELECT * FROM ${process.env.SCHEMA}.reports WHERE job_run_id = $1 and report_type = $2
          order by created_at DESC
          limit 1;
          `,
        [jobRunId, "JOBS_REPORT"]
      );
      expect(puppeteer.launch).toHaveBeenCalledWith({
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas"
        ],
        executablePath: "/usr/bin/chromium-browser",
        headless: true,
        protocolTimeout: 60000,
      });
      expect(mockBrowser.newPage).toHaveBeenCalled();
      expect(mockPage.setContent).toHaveBeenCalledWith(mockHtml, {
        waitUntil: "networkidle0",
      });
      expect(mockPage.pdf).toHaveBeenCalledWith({
        format: "A4",
        printBackground: true,
        scale: 0.6,
        landscape: true,
      });
      expect(mockBrowser.close).toHaveBeenCalled();
      expect(result).toEqual(mockPdfBuffer);
    });

    it("should throw an error if the report data is invalid", async () => {
      const jobRunId = "test-jobRunId";

      jest
        .spyOn(mockReportsRepo, "query")
        .mockResolvedValue([{ report_data: "{}" }]);
      jest.spyOn(path, "join").mockReturnValue("/mock/template/path.hbs");
      jest.spyOn(fs, "readFileSync").mockReturnValue("<html></html>");
      jest.spyOn(hbs, "compile").mockReturnValue(() => "<html></html>");

      await expect(pdfService.generateJobsReportPdf(jobRunId)).rejects.toThrow(
        "Failed to generate jobs report"
      );

      expect(mockReportsRepo.query).toHaveBeenCalled();
    });

    it("should throw an HTTP exception if an error occurs", async () => {
      const jobRunId = "test-jobRunId";

      jest
        .spyOn(mockReportsRepo, "query")
        .mockRejectedValue(new Error("Database error"));

      await expect(pdfService.generateJobsReportPdf(jobRunId)).rejects.toThrow(
        "Failed to generate jobs report"
      );

      expect(mockReportsRepo.query).toHaveBeenCalled();
    });
  });
});

function normalizeHtml(html: string): string {
  return html
    .replace(/\s+/g, ' ') 
    .trim();             
}
