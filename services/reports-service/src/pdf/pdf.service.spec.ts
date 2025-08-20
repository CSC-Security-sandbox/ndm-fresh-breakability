import { Test, TestingModule } from "@nestjs/testing";
import { PdfService } from "./pdf.service";
import { InventoryEntity } from "src/entities/inventory.entity";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ReportsEntity } from "src/entities/reports.entity";
import { ReportType } from "src/constants/enums";
import * as fs from "fs";
import * as path from "path";
import { DiscoveryService } from "src/discovery/discovery.service";
import { PDFGeneratorService } from "src/generator/pdf-generator.service";
import { PDFTemplate } from "src/generator/pdf-generator.type";

describe("PdfService", () => {
  let pdfService: PdfService;
  let mockInventoryRepo;
  let mockReportsRepo;
  let mockDiscoveryService: Partial<DiscoveryService>;
  let mockPdfGeneratorService: Partial<PDFGeneratorService>;

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();
    
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

    mockPdfGeneratorService = {
      generatePDF: jest.fn().mockResolvedValue(Buffer.from("mockPdfGeneratorBuffer")),
      initBrowser: jest.fn().mockResolvedValue(undefined),
      onApplicationShutdown: jest.fn().mockResolvedValue(undefined),
    };

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
        {
          provide: DiscoveryService,
          useValue: mockDiscoveryService,
        },
        {
          provide: PDFGeneratorService,
          useValue: mockPdfGeneratorService,
        },
      ],
    }).compile();

    pdfService = module.get<PdfService>(PdfService);
  });

  describe("generatePdf", () => {
    it("should generate and save new PDF if report type is JOBS_RREPORT", async () => {
      const jobRunId = "test-jobRunId";
      const reportType = ReportType.JOBS_RREPORT;
      const pdfBuffer = Buffer.from("newPdfGeneratorBuffer");
      const filePath = "/mock/reports/test-jobRunId-jobs_rreport-report.pdf";

      jest.spyOn(path, "join").mockReturnValue(filePath);
      jest.spyOn(path, "resolve").mockReturnValue("/mock/reports");
      jest.spyOn(mockPdfGeneratorService, "generatePDF").mockResolvedValue(pdfBuffer);
      jest
        .spyOn(pdfService, "generateJobsReportPdf")
        .mockResolvedValue(pdfBuffer);

      const result = await pdfService.generatePdf(jobRunId, reportType);

      expect(result).toEqual(pdfBuffer);
      expect(pdfService.generateJobsReportPdf).toHaveBeenCalledWith(jobRunId);
    });
    it("should return the existing report if it exists and report type is DISCOVERY", async () => {
      const jobRunId = "test-jobRunId";
      const reportType = ReportType.DISCOVERY;
      const fileName = `${jobRunId}-${reportType.toLowerCase()}-report.pdf`;
      const filePath = `/mock/reports/${fileName}`;

      jest.spyOn(path, "join").mockReturnValue(filePath);
      jest.spyOn(path, "resolve").mockReturnValue("/mock/reports");
      jest.spyOn(fs, "existsSync").mockReturnValue(true);
      jest
        .spyOn(fs, "readFileSync")
        .mockReturnValue(Buffer.from("existingReportBuffer"));

      const result = await pdfService.generatePdf(jobRunId, reportType);

      expect(result).toEqual(Buffer.from("existingReportBuffer"));
      expect(fs.existsSync).toHaveBeenCalledWith(filePath);
      expect(fs.readFileSync).toHaveBeenCalledWith(filePath);
    });
    it("should throw an error if report type is invalid", async () => {
      const jobRunId = "test-jobRunId";
      const reportType = "INVALID_REPORT_TYPE" as unknown as ReportType;
      const filePath = "/mock/reports/test-jobRunId-invalid_report_type-report.pdf";

      jest.spyOn(path, "join").mockReturnValue(filePath);
      jest.spyOn(path, "resolve").mockReturnValue("/mock/reports");

      await expect(
        pdfService.generatePdf(jobRunId, reportType)
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

    it("should successfully generate a PDF with proper customerInfo and pdfGeneratorService workflow", async () => {
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

      // Mock PDF generator service
      const expectedPdfBuffer = Buffer.from("mockPdfGeneratorBuffer");
      jest.spyOn(mockPdfGeneratorService, "generatePDF").mockResolvedValue(expectedPdfBuffer);

      // Execute the method
      const result = await pdfService.generateJobsReportPdf(jobRunId);

      // Verify the result
      expect(result).toEqual(expectedPdfBuffer);

      // Verify PDF generator service was called correctly
      expect(mockPdfGeneratorService.generatePDF).toHaveBeenCalledWith({
        data: expect.objectContaining({
          summary: expect.arrayContaining([{ source: { job_type: "MIGRATE" } }]),
          last_iteration: expect.objectContaining({
            summary: { source: { job_type: "MIGRATE" } }
          }),
          last_errors: expect.objectContaining({
            summary: { source: { job_type: "MIGRATE" } }
          }),
          cutovers: [],
          customerInfo: {
            projectName: "Test Project",
            reportDate: expect.any(String),
          }
        }),
        template: PDFTemplate.JOBS_REPORT,
        pdfOptions: {
          format: 'A0',
          printBackground: true,
          scale: 0.5,
          landscape: true,
        }
      });
    });

    it("should throw an error if the report data is invalid", async () => {
      const jobRunId = "test-jobRunId";

      jest
        .spyOn(mockReportsRepo, "query")
        .mockResolvedValue([{ report_data: "{}" }]);

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

    it("should throw an error if the report data is missing", async () => {
      const jobRunId = "test-jobRunId";

      jest.spyOn(mockReportsRepo, "query").mockResolvedValue([{}]);

      await expect(pdfService.generateJobsReportPdf(jobRunId)).rejects.toThrow(
        "Failed to generate jobs report"
      );
    });

    it("should throw an error if PDF generation fails", async () => {
      const jobRunId = "test-jobRunId";
      const mockProjectData = [{ project_name: "Test Project" }];
      const mockReportData = {
        report_data: JSON.stringify({
          summary: [{ sub_category: "SubCat1", value: "100" }],
          last_iteration: {},
          last_errors: {},
        }),
      };

      process.env.SCHEMA = "datamigrator";

      jest.spyOn(mockInventoryRepo, "query").mockResolvedValue(mockProjectData);
      jest.spyOn(mockReportsRepo, "query").mockResolvedValue([mockReportData]);
      jest.spyOn(mockPdfGeneratorService, "generatePDF").mockRejectedValue(new Error("PDF generation failed"));

      await expect(pdfService.generateJobsReportPdf(jobRunId)).rejects.toThrow(
        "Failed to generate jobs report"
      );
    });

    it("should throw an error if PDF generator service fails", async () => {
      const jobRunId = "test-jobRunId";
      const mockProjectData = [{ project_name: "Test Project" }];
      const mockReportData = {
        report_data: JSON.stringify({
          summary: [{ sub_category: "SubCat1", value: "100" }],
          last_iteration: {},
          last_errors: {},
        }),
      };

      process.env.SCHEMA = "datamigrator";

      jest.spyOn(mockInventoryRepo, "query").mockResolvedValue(mockProjectData);
      jest.spyOn(mockReportsRepo, "query").mockResolvedValue([mockReportData]);
      jest
        .spyOn(mockPdfGeneratorService, "generatePDF")
        .mockRejectedValue(new Error("PDF Service error"));

      await expect(pdfService.generateJobsReportPdf(jobRunId)).rejects.toThrow(
        "Failed to generate jobs report"
      );
    });
  });
});