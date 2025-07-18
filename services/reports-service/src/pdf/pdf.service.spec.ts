import { Test, TestingModule } from "@nestjs/testing";
import { PdfService } from "./pdf.service";
import { getRepositoryToken } from "@nestjs/typeorm";
import { InventoryEntity } from "src/entities/inventory.entity";
import { ReportsEntity } from "src/entities/reports.entity";
import { DiscoveryService } from "../discovery/discovery.service";
import { ReportType } from "src/constants/enums";
import * as fs from "fs";
import * as path from "path";
import * as hbs from "hbs";

jest.mock("fs");
jest.mock("hbs");
jest.mock("puppeteer", () => ({
  launch: jest.fn(),
}));

import * as puppeteer from "puppeteer";

describe("PdfService", () => {
  let service: PdfService;
  let discoveryService: DiscoveryService;
  let inventoryRepo: any;
  let reportsRepo: any;

  const mockJobRunId = "job-123";
  const mockPdfBuffer = Buffer.from("PDF content");

  beforeEach(async () => {
    mockInventoryRepo = {
      query: jest.fn(),
    };

    mockReportsRepo = {
      query: jest.fn(),
      find: jest.fn(),
    };

    mockDiscoveryService = {
      createJobsPDFReportData: jest.fn(),
    };

    mockPage = {
      setContent: jest.fn().mockResolvedValue(null),
      pdf: jest.fn().mockResolvedValue(Buffer.from("mockPdfBuffer")),
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

    process.env.REPORT_DOWNLOAD_LOCATION = "./reports";

    jest
      .spyOn(path, "join")
      .mockImplementation((...paths: string[]) => path.resolve(...paths));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  describe("generatePdf", () => {
    it("should return existing report if file exists and type is DISCOVERY", async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(mockPdfBuffer);

      const result = await service.generatePdf(
        mockJobRunId,
        ReportType.DISCOVERY
      );
      expect(result).toEqual(mockPdfBuffer);
    });

    it("should call generateJobsReportPdf if type is JOBS_REPORT", async () => {
      const spy = jest
        .spyOn(service, "generateJobsReportPdf")
        .mockResolvedValue(mockPdfBuffer);

      const result = await service.generatePdf(
        mockJobRunId,
        ReportType.JOBS_RREPORT
      );
      expect(spy).toHaveBeenCalledWith(mockJobRunId);
      expect(result).toEqual(mockPdfBuffer);
    });

    it("should throw if report does not exist and is not JOBS_REPORT", async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(
        service.generatePdf(mockJobRunId, ReportType.DISCOVERY)
      ).rejects.toThrow("Report not found, try again later");
    });
    it("should throw error if file path escapes reports directory", async () => {
      const jobRunId = "../escape";
      const reportType = ReportType.DISCOVERY;
      const filePath = "/some/other/path/escape-discovery-report.pdf";

      jest.spyOn(path, "join").mockReturnValue(filePath);
      jest.spyOn(path, "resolve").mockReturnValue("/mock/reports");

      await expect(
        pdfService.generatePdf(jobRunId, reportType)
      ).rejects.toThrow("Invalid file path");
    });
  });

  describe("generateJobsReportPdf", () => {
    it("should throw an error and call createJobsPDFReportData when report data is not found", async () => {
      const jobRunId = "test-jobRunId";

      // Mock empty result from reports query
      jest.spyOn(mockReportsRepo, "query").mockResolvedValue([]);
      jest.spyOn(mockInventoryRepo, "query").mockResolvedValue([]);

      // Expect the function to throw an HttpException
      await expect(pdfService.generateJobsReportPdf(jobRunId)).rejects.toThrow(
        "Failed to generate jobs report"
      );

      // Verify that discoveryService.createJobsPDFReportData was called
      expect(mockDiscoveryService.createJobsPDFReportData).toHaveBeenCalledWith(
        jobRunId
      );
    });

    it("should successfully generate a PDF with proper customerInfo and puppeteer workflow", async () => {
      const jobRunId = "test-jobRunId";
      const mockProjectData = [{ project_name: "Test Project" }];
      const mockReportData = {
        report_data: JSON.stringify({
          summary: [{ source: { job_type: "MIGRATE" } }],
          last_iteration: {},
          last_errors: {},
        }),
      };

      // Mock repository responses
      jest.spyOn(mockInventoryRepo, "query").mockResolvedValue(mockProjectData);
      jest.spyOn(mockReportsRepo, "query").mockResolvedValue([mockReportData]);

      // Mock file system and template operations
      jest.spyOn(path, "join").mockReturnValue("/mock/template/path.hbs");
      jest
        .spyOn(fs, "readFileSync")
        .mockReturnValue("<html>{{customerInfo.projectName}}</html>");
      jest
        .spyOn(hbs, "compile")
        .mockReturnValue(
          (data) => `<html>${data.customerInfo.projectName}</html>`
        );

      // Execute the method
      const result = await pdfService.generateJobsReportPdf(jobRunId);

      // Verify the result
      expect(result).toEqual(Buffer.from("mockPdfBuffer"));

      // Verify puppeteer was used correctly
      expect(puppeteer.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          headless: true,
          args: expect.arrayContaining([
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
          ]),
          executablePath: "/usr/bin/chromium-browser",
          protocolTimeout: 60000,
        })
      );

      // Verify page operations
      expect(mockBrowser.newPage).toHaveBeenCalled();
      expect(mockPage.setContent).toHaveBeenCalled();
      expect(mockPage.pdf).toHaveBeenCalledWith({
        format: "A4",
        printBackground: true,
        scale: 0.6,
        landscape: true,
      });

      // Verify browser was closed
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it("should throw an error if the report data is invalid", async () => {
      const jobRunId = "test-jobRunId";

      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify({
            summary: [{ source: { job_type: "CUT_OVER" } }],
          }),
        },
      ]);

      inventoryRepo.query.mockResolvedValue([{ project_name: "Test Project" }]);

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

    it("should handle missing report data and call discovery service", async () => {
      reportsRepo.query.mockResolvedValue([]);
      const spy = jest.spyOn(discoveryService, "createJobsPDFReportData");

      await expect(service.generateJobsReportPdf(mockJobRunId)).rejects.toThrow(
        "Failed to generate jobs report"
      );

      expect(spy).toHaveBeenCalledWith(mockJobRunId);
    });

    it("should throw if summary is invalid", async () => {
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify({ summary: [] }),
        },
      ]);
      inventoryRepo.query.mockResolvedValue([]);

      await expect(service.generateJobsReportPdf(mockJobRunId)).rejects.toThrow(
        "Failed to generate jobs report"
      );
    });

    it("should catch and log puppeteer launch error", async () => {
      (hbs.compile as jest.Mock).mockReturnValue(() => "<html></html>");
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify({
            summary: [{ source: { job_type: "CUT_OVER" } }],
          }),
        },
      ]);
      inventoryRepo.query.mockResolvedValue([]);

      (puppeteer.launch as jest.Mock).mockRejectedValue(
        new Error("Launch failed")
      );

      await expect(service.generateJobsReportPdf(mockJobRunId)).rejects.toThrow(
        "Failed to generate jobs report"
      );
    });
  });
});
