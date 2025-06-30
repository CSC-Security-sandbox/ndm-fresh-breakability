import { Test, TestingModule } from "@nestjs/testing";
import { PdfService } from "./pdf.service";
import { InventoryEntity } from "src/entities/inventory.entity";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ReportsEntity } from "src/entities/reports.entity";
import { ReportType } from "src/constants/enums";
import * as fs from "fs";
import * as path from "path";
import * as puppeteer from "puppeteer";
import { Browser, Page } from "puppeteer";
import * as hbs from "hbs";
import { DiscoveryService } from "src/discovery/discovery.service";

jest.mock("puppeteer");

describe("PdfService", () => {
  let pdfService: PdfService;
  let mockInventoryRepo;
  let mockReportsRepo;
  let mockBrowser: Partial<Browser>;
  let mockPage: Partial<Page>;
  let mockDiscoveryService: Partial<DiscoveryService>;

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
      ],
    }).compile();

    pdfService = module.get<PdfService>(PdfService);
  });

  describe("generatePdf", () => {
    it("should generate and save new PDF if report type is JOBS_RREPORT", async () => {
      const jobRunId = "test-jobRunId";
      const reportType = ReportType.JOBS_RREPORT;
      const pdfBuffer = Buffer.from("newPdfBuffer");
      const filePath = "/mock/reports/report.pdf";

      jest.spyOn(path, "join").mockReturnValue(filePath);
      jest
        .spyOn(pdfService, "generateJobsReportPdf")
        .mockResolvedValue(pdfBuffer);
      jest.spyOn(fs, "existsSync").mockReturnValue(false);
      jest.spyOn(fs, "writeFileSync").mockImplementation();
      jest.spyOn(path, "resolve").mockReturnValue("/mock/reports");

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

    it("should throw an error if the report data is missing", async () => {
      const jobRunId = "test-jobRunId";

      jest.spyOn(mockReportsRepo, "query").mockResolvedValue([{}]);
      jest.spyOn(path, "join").mockReturnValue("/mock/template/path.hbs");
      jest.spyOn(fs, "readFileSync").mockReturnValue("<html></html>");
      jest.spyOn(hbs, "compile").mockReturnValue(() => "<html></html>");

      await expect(pdfService.generateJobsReportPdf(jobRunId)).rejects.toThrow(
        "Failed to generate jobs report"
      );
    });

    it("should throw an error if the HTML template is not found", async () => {
      const jobRunId = "test-jobRunId";
      const mockReportData = {
        report_data: JSON.stringify({
          summary: [{ sub_category: "SubCat1", value: "100" }],
          last_iteration: {},
          last_errors: {},
        }),
      };

      process.env.SCHEMA = "datamigrator";

      jest.spyOn(mockReportsRepo, "query").mockResolvedValue([mockReportData]);
      jest.spyOn(path, "join").mockReturnValue("/mock/template/path.hbs");
      jest.spyOn(fs, "readFileSync").mockImplementation(() => {
        throw new Error("File not found");
      });

      await expect(pdfService.generateJobsReportPdf(jobRunId)).rejects.toThrow(
        "Failed to generate jobs report"
      );
    });

    it("should throw an error if puppeteer fails to launch", async () => {
      const jobRunId = "test-jobRunId";
      const mockReportData = {
        report_data: JSON.stringify({
          summary: [{ sub_category: "SubCat1", value: "100" }],
          last_iteration: {},
          last_errors: {},
        }),
      };

      process.env.SCHEMA = "datamigrator";

      jest.spyOn(mockReportsRepo, "query").mockResolvedValue([mockReportData]);
      jest.spyOn(path, "join").mockReturnValue("/mock/template/path.hbs");
      jest.spyOn(fs, "readFileSync").mockReturnValue("<html></html>");
      jest.spyOn(hbs, "compile").mockReturnValue(() => "<html></html>");
      jest
        .spyOn(puppeteer, "launch")
        .mockRejectedValue(new Error("Launch error"));

      await expect(pdfService.generateJobsReportPdf(jobRunId)).rejects.toThrow(
        "Failed to generate jobs report"
      );
    });

    it("should generate a PDF buffer successfully with valid report data", async () => {
      const jobRunId = "test-jobRunId";
      const mockProjectData = [{ project_name: "Test Project" }];
      const mockReportData = {
        report_data: JSON.stringify({
          summary: [
            {
              sub_category: "SubCat1",
              value: "100",
              source: { job_type: "CUT_OVER" },
            },
          ],
          last_iteration: {},
          last_errors: {},
        }),
      };

      process.env.SCHEMA = "datamigrator";

      jest
        .spyOn(mockReportsRepo, "query")
        .mockResolvedValueOnce(mockProjectData) // inventoryRepo.query
        .mockResolvedValueOnce([mockReportData]); // reportsRepo.query

      jest.spyOn(mockInventoryRepo, "query").mockResolvedValue(mockProjectData);

      jest.spyOn(path, "join").mockReturnValue("/mock/template/path.hbs");
      jest
        .spyOn(fs, "readFileSync")
        .mockReturnValue("<html>{{customerInfo.projectName}}</html>");
      jest
        .spyOn(hbs, "compile")
        .mockReturnValue(() => "<html>Test Project</html>");
      jest.spyOn(puppeteer, "launch").mockResolvedValue(mockBrowser as Browser);

      const result = await pdfService.generateJobsReportPdf(jobRunId);

      expect(mockInventoryRepo.query).toHaveBeenCalled();
      expect(mockReportsRepo.query).toHaveBeenCalled();
      expect(fs.readFileSync).toHaveBeenCalledWith(
        "/mock/template/path.hbs",
        "utf8"
      );
      expect(result).toEqual(Buffer.from("mockPdfBuffer"));
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it("should call discoveryService.createJobsPDFReportData and throw if no report data found", async () => {
      const jobRunId = "test-jobRunId";
      const mockDiscoveryServiceInstance = {
        createJobsPDFReportData: jest.fn(),
      };
      // Replace the provider for this test
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
            useValue: mockDiscoveryServiceInstance,
          },
        ],
      }).compile();

      const pdfServiceWithMockDiscovery = module.get<PdfService>(PdfService);

      jest.spyOn(mockInventoryRepo, "query").mockResolvedValue([]);
      jest.spyOn(mockReportsRepo, "query").mockResolvedValue([]);

      jest.spyOn(path, "join").mockReturnValue("/mock/template/path.hbs");
      jest.spyOn(fs, "readFileSync").mockReturnValue("<html></html>");
      jest.spyOn(hbs, "compile").mockReturnValue(() => "<html></html>");

      await expect(
        pdfServiceWithMockDiscovery.generateJobsReportPdf(jobRunId)
      ).rejects.toThrow("Report data not found");
      expect(
        mockDiscoveryServiceInstance.createJobsPDFReportData
      ).toHaveBeenCalledWith(jobRunId);
    });

    it("should use default project name if projectData is empty", async () => {
      const jobRunId = "test-jobRunId";
      const mockProjectData: any[] = [];
      const mockReportData = {
        report_data: JSON.stringify({
          summary: [
            {
              sub_category: "SubCat1",
              value: "100",
              source: { job_type: "CUT_OVER" },
            },
          ],
          last_iteration: {},
          last_errors: {},
        }),
      };

      process.env.SCHEMA = "datamigrator";

      jest.spyOn(mockInventoryRepo, "query").mockResolvedValue(mockProjectData);
      jest.spyOn(mockReportsRepo, "query").mockResolvedValue([mockReportData]);
      jest.spyOn(path, "join").mockReturnValue("/mock/template/path.hbs");
      jest
        .spyOn(fs, "readFileSync")
        .mockReturnValue("<html>{{customerInfo.projectName}}</html>");
      jest
        .spyOn(hbs, "compile")
        .mockReturnValue(() => "<html>NetApp Data Migrator</html>");
      jest.spyOn(puppeteer, "launch").mockResolvedValue(mockBrowser as Browser);

      const result = await pdfService.generateJobsReportPdf(jobRunId);

      expect(result).toEqual(Buffer.from("mockPdfBuffer"));
      expect(mockInventoryRepo.query).toHaveBeenCalled();
      expect(mockReportsRepo.query).toHaveBeenCalled();
      expect(fs.readFileSync).toHaveBeenCalledWith(
        "/mock/template/path.hbs",
        "utf8"
      );
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it("should throw HttpException if no report data is found and call discoveryService.createJobsPDFReportData", async () => {
      const jobRunId = "jobRunId-no-data";
      const mockDiscoveryServiceInstance = {
        createJobsPDFReportData: jest.fn(),
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
            useValue: mockDiscoveryServiceInstance,
          },
        ],
      }).compile();
      const pdfServiceWithDiscovery = module.get<PdfService>(PdfService);

      jest.spyOn(mockInventoryRepo, "query").mockResolvedValue([]);
      jest.spyOn(mockReportsRepo, "query").mockResolvedValue([]);

      jest.spyOn(path, "join").mockReturnValue("/mock/template/path.hbs");
      jest.spyOn(fs, "readFileSync").mockReturnValue("<html></html>");
      jest.spyOn(hbs, "compile").mockReturnValue(() => "<html></html>");

      await expect(
        pdfServiceWithDiscovery.generateJobsReportPdf(jobRunId)
      ).rejects.toThrow("Report data not found");
      expect(
        mockDiscoveryServiceInstance.createJobsPDFReportData
      ).toHaveBeenCalledWith(jobRunId);
    });

    it("should throw HttpException if reportData.summary is missing or empty", async () => {
      const jobRunId = "jobRunId-empty-summary";
      const mockProjectData = [{ project_name: "Test Project" }];
      const mockReportData = {
        report_data: JSON.stringify({
          summary: [],
          last_iteration: {},
          last_errors: {},
        }),
      };
      jest.spyOn(mockInventoryRepo, "query").mockResolvedValue(mockProjectData);
      jest.spyOn(mockReportsRepo, "query").mockResolvedValue([mockReportData]);
      jest.spyOn(path, "join").mockReturnValue("/mock/template/path.hbs");
      jest.spyOn(fs, "readFileSync").mockReturnValue("<html></html>");
      jest.spyOn(hbs, "compile").mockReturnValue(() => "<html></html>");

      await expect(pdfService.generateJobsReportPdf(jobRunId)).rejects.toThrow(
        "Failed to generate jobs report"
      );
    });

    it("should throw HttpException if reading the template fails", async () => {
      const jobRunId = "jobRunId-template-fail";
      const mockProjectData = [{ project_name: "Test Project" }];
      const mockReportData = {
        report_data: JSON.stringify({
          summary: [
            {
              sub_category: "SubCat1",
              value: "100",
              source: { job_type: "CUT_OVER" },
            },
          ],
          last_iteration: {},
          last_errors: {},
        }),
      };
      jest.spyOn(mockInventoryRepo, "query").mockResolvedValue(mockProjectData);
      jest.spyOn(mockReportsRepo, "query").mockResolvedValue([mockReportData]);
      jest.spyOn(path, "join").mockReturnValue("/mock/template/path.hbs");
      jest.spyOn(fs, "readFileSync").mockImplementation(() => {
        throw new Error("File not found");
      });

      await expect(pdfService.generateJobsReportPdf(jobRunId)).rejects.toThrow(
        "Failed to generate jobs report"
      );
    });

    it("should throw HttpException if puppeteer fails to launch", async () => {
      const jobRunId = "jobRunId-puppeteer-fail";
      const mockProjectData = [{ project_name: "Test Project" }];
      const mockReportData = {
        report_data: JSON.stringify({
          summary: [
            {
              sub_category: "SubCat1",
              value: "100",
              source: { job_type: "CUT_OVER" },
            },
          ],
          last_iteration: {},
          last_errors: {},
        }),
      };
      jest.spyOn(mockInventoryRepo, "query").mockResolvedValue(mockProjectData);
      jest.spyOn(mockReportsRepo, "query").mockResolvedValue([mockReportData]);
      jest.spyOn(path, "join").mockReturnValue("/mock/template/path.hbs");
      jest.spyOn(fs, "readFileSync").mockReturnValue("<html></html>");
      jest.spyOn(hbs, "compile").mockReturnValue(() => "<html></html>");
      jest
        .spyOn(puppeteer, "launch")
        .mockRejectedValue(new Error("Launch error"));

      await expect(pdfService.generateJobsReportPdf(jobRunId)).rejects.toThrow(
        "Failed to generate jobs report"
      );
    });

    it("should generate PDF buffer successfully with valid data", async () => {
      const jobRunId = "jobRunId-success";
      const mockProjectData = [{ project_name: "Test Project" }];
      const mockReportData = {
        report_data: JSON.stringify({
          summary: [
            {
              sub_category: "SubCat1",
              value: "100",
              source: { job_type: "CUT_OVER" },
            },
          ],
          last_iteration: {},
          last_errors: {},
        }),
      };
      jest.spyOn(mockInventoryRepo, "query").mockResolvedValue(mockProjectData);
      jest.spyOn(mockReportsRepo, "query").mockResolvedValue([mockReportData]);
      jest.spyOn(path, "join").mockReturnValue("/mock/template/path.hbs");
      jest
        .spyOn(fs, "readFileSync")
        .mockReturnValue("<html>{{customerInfo.projectName}}</html>");
      jest
        .spyOn(hbs, "compile")
        .mockReturnValue(() => "<html>Test Project</html>");
      jest.spyOn(puppeteer, "launch").mockResolvedValue(mockBrowser as Browser);

      const result = await pdfService.generateJobsReportPdf(jobRunId);

      expect(result).toEqual(Buffer.from("mockPdfBuffer"));
      expect(mockInventoryRepo.query).toHaveBeenCalled();
      expect(mockReportsRepo.query).toHaveBeenCalled();
      expect(fs.readFileSync).toHaveBeenCalledWith(
        "/mock/template/path.hbs",
        "utf8"
      );
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it("should use default project name if projectData is empty", async () => {
      const jobRunId = "jobRunId-default-project";
      const mockProjectData: any[] = [];
      const mockReportData = {
        report_data: JSON.stringify({
          summary: [
            {
              sub_category: "SubCat1",
              value: "100",
              source: { job_type: "CUT_OVER" },
            },
          ],
          last_iteration: {},
          last_errors: {},
        }),
      };
      jest.spyOn(mockInventoryRepo, "query").mockResolvedValue(mockProjectData);
      jest.spyOn(mockReportsRepo, "query").mockResolvedValue([mockReportData]);
      jest.spyOn(path, "join").mockReturnValue("/mock/template/path.hbs");
      jest
        .spyOn(fs, "readFileSync")
        .mockReturnValue("<html>{{customerInfo.projectName}}</html>");
      jest
        .spyOn(hbs, "compile")
        .mockReturnValue(() => "<html>NetApp Data Migrator</html>");
      jest.spyOn(puppeteer, "launch").mockResolvedValue(mockBrowser as Browser);

      const result = await pdfService.generateJobsReportPdf(jobRunId);

      expect(result).toEqual(Buffer.from("mockPdfBuffer"));
      expect(mockInventoryRepo.query).toHaveBeenCalled();
      expect(mockReportsRepo.query).toHaveBeenCalled();
      expect(fs.readFileSync).toHaveBeenCalledWith(
        "/mock/template/path.hbs",
        "utf8"
      );
      expect(mockBrowser.close).toHaveBeenCalled();
    });
  });
});

function normalizeHtml(html: string): string {
  return html.replace(/\s+/g, " ").trim();
}
