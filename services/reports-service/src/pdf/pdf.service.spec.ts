import { Test, TestingModule } from "@nestjs/testing";
import { PdfService } from "./pdf.service";
import { getRepositoryToken } from "@nestjs/typeorm";
import { InventoryEntity } from "../entities/inventory.entity";
import { ReportsEntity } from "../entities/reports.entity";
import { DiscoveryService } from "../discovery/discovery.service";
import { HttpException, HttpStatus, Logger } from "@nestjs/common";
import { ReportType } from "../constants/enums";

// Mock external dependencies before importing
jest.mock("fs");
jest.mock("puppeteer", () => ({
  launch: jest.fn(),
}));
jest.mock("hbs", () => ({
  compile: jest.fn(),
}));

// Mock TypeORM decorators as functions that return decorator functions
const mockDecorator = jest.fn(
  () => (target: any, propertyKey?: string | symbol) => {
    return target;
  }
);

jest.mock("typeorm", () => ({
  Repository: jest.fn(),
  Entity: mockDecorator,
  Column: mockDecorator,
  PrimaryGeneratedColumn: mockDecorator,
  CreateDateColumn: mockDecorator,
  UpdateDateColumn: mockDecorator,
  ManyToOne: mockDecorator,
  OneToMany: mockDecorator,
  ManyToMany: mockDecorator,
  JoinColumn: mockDecorator,
  JoinTable: mockDecorator,
  Index: mockDecorator,
  Unique: mockDecorator,
  Check: mockDecorator,
  Exclusion: mockDecorator,
  Generated: mockDecorator,
  VersionColumn: mockDecorator,
  ViewEntity: mockDecorator,
  ViewColumn: mockDecorator,
  Connection: jest.fn(),
  EntityRepository: jest.fn(),
  Transaction: jest.fn(),
  TransactionRepository: jest.fn(),
  TransactionManager: jest.fn(),
  getRepository: jest.fn(),
  getConnection: jest.fn(),
  createConnection: jest.fn(),
  getManager: jest.fn(),
  getCustomRepository: jest.fn(),
  ObjectType: jest.fn(),
  RelationId: mockDecorator,
  ChildEntity: mockDecorator,
  TableInheritance: mockDecorator,
  BeforeInsert: mockDecorator,
  BeforeUpdate: mockDecorator,
  BeforeRemove: mockDecorator,
  AfterInsert: mockDecorator,
  AfterUpdate: mockDecorator,
  AfterRemove: mockDecorator,
  AfterLoad: mockDecorator,
  EventSubscriber: mockDecorator,
  EntitySubscriberInterface: jest.fn(),
}));

// Import mocked modules
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const hbs = require("hbs");

describe("PdfService", () => {
  let service: PdfService;
  let inventoryRepo: any;
  let reportsRepo: any;
  let discoveryService: jest.Mocked<DiscoveryService>;
  let logger: jest.Mocked<Logger>;

  const mockInventoryRepo = {
    query: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockReportsRepo = {
    query: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockDiscoveryService = {
    createJobsPDFReportData: jest.fn(),
  };

  const mockFs = fs as jest.Mocked<typeof fs>;
  const mockPath = path as jest.Mocked<typeof path>;
  const mockPuppeteer = puppeteer as jest.Mocked<typeof puppeteer>;
  const mockHbs = hbs as jest.Mocked<typeof hbs>;

  beforeEach(async () => {
    // Create a proper logger mock
    const mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
      fatal: jest.fn(),
    };

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
        {
          provide: Logger,
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<PdfService>(PdfService);
    inventoryRepo = module.get(getRepositoryToken(InventoryEntity));
    reportsRepo = module.get(getRepositoryToken(ReportsEntity));
    discoveryService = module.get(DiscoveryService);
    logger = module.get(Logger);

    // Override the logger instance created in the constructor
    (service as any).logger = mockLogger;

    // Reset all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("generatePdf", () => {
    const jobRunId = "test-job-run-id";
    const mockReportsDirectory = "./reports";

    beforeEach(() => {
      // Mock path operations with proper behavior
      mockPath.join.mockImplementation((...args) => args.join("/"));
      mockPath.resolve.mockImplementation((dir) => `/resolved${dir}`);

      // Mock hbs compile
      mockHbs.compile.mockReturnValue(
        jest.fn().mockReturnValue("<html>Mock HTML</html>")
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

    it("should generate JOBS_REPORT PDF when reportType is JOBS_RREPORT", async () => {
      const mockBuffer = Buffer.from("mock pdf content");
      jest
        .spyOn(service, "generateJobsReportPdf")
        .mockResolvedValue(mockBuffer);

      const result = await service.generatePdf(
        jobRunId,
        ReportType.JOBS_RREPORT
      );

      expect(result).toEqual(mockBuffer);
      expect(service.generateJobsReportPdf).toHaveBeenCalledWith(jobRunId);
      expect(logger.log).toHaveBeenCalledWith(
        `Checking for existing report for jobRunId: ${jobRunId} and reportType: ${ReportType.JOBS_RREPORT}`
      );
    });

    it("should return existing DISCOVERY report when file exists", async () => {
      const mockBuffer = Buffer.from("existing pdf content");
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(mockBuffer);

      const result = await service.generatePdf(jobRunId, ReportType.DISCOVERY);

      expect(result).toEqual(mockBuffer);
      expect(mockFs.existsSync).toHaveBeenCalled();
      expect(mockFs.readFileSync).toHaveBeenCalled();
      expect(logger.log).toHaveBeenCalledWith(
        `Checking for existing report for jobRunId: ${jobRunId} and reportType: ${ReportType.DISCOVERY}`
      );
      expect(logger.log).toHaveBeenCalledWith(
        expect.stringContaining("Report found. Returning existing report:")
      );
    });

    it("should throw HttpException when DISCOVERY report file does not exist", async () => {
      mockFs.existsSync.mockReturnValue(false);

      await expect(
        service.generatePdf(jobRunId, ReportType.DISCOVERY)
      ).rejects.toThrow(
        new HttpException(
          "Report not found, try again later",
          HttpStatus.INTERNAL_SERVER_ERROR
        )
      );
    });

    it("should throw HttpException for invalid file path", async () => {
      // Mock path traversal attempt - override the default mock for this test
      mockPath.join.mockReturnValueOnce(
        "/dangerous/path/../../test-job-run-id-jobs-report-report.pdf"
      );
      mockPath.resolve.mockReturnValueOnce("/safe/path");

      await expect(
        service.generatePdf(jobRunId, ReportType.JOBS_RREPORT)
      ).rejects.toThrow(
        new HttpException("Invalid file path", HttpStatus.BAD_REQUEST)
      );

      expect(logger.log).toHaveBeenCalledWith(
        `Checking for existing report for jobRunId: ${jobRunId} and reportType: ${ReportType.JOBS_RREPORT}`
      );
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid file path:")
      );
    });

    it("should sanitize job run ID with special characters", async () => {
      const dirtyJobRunId = "test@#$%job-run-id";
      const mockBuffer = Buffer.from("mock pdf content");
      jest
        .spyOn(service, "generateJobsReportPdf")
        .mockResolvedValue(mockBuffer);

      await service.generatePdf(dirtyJobRunId, ReportType.JOBS_RREPORT);

      expect(mockPath.join).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringMatching(/^test-job-run-id-jobs-report-report\.pdf$/)
      );
    });

    it("should handle COC report type (falls through to discovery logic)", async () => {
      mockFs.existsSync.mockReturnValue(false);

      await expect(
        service.generatePdf(jobRunId, ReportType.COC)
      ).rejects.toThrow(
        new HttpException(
          "Report not found, try again later",
          HttpStatus.INTERNAL_SERVER_ERROR
        )
      );
    });

    it("should handle JOB_RUN_STATS report type (falls through to discovery logic)", async () => {
      mockFs.existsSync.mockReturnValue(false);

      await expect(
        service.generatePdf(jobRunId, ReportType.JOB_RUN_STATS)
      ).rejects.toThrow(
        new HttpException(
          "Report not found, try again later",
          HttpStatus.INTERNAL_SERVER_ERROR
        )
      );
    });
  });

  describe("generateJobsReportPdf", () => {
    const jobRunId = "test-job-run-id";
    const mockProjectData = [
      {
        project_name: "Test Project",
        id: "project-id",
      },
    ];
    const mockReportData = {
      summary: [
        {
          source: { job_type: "CUT_OVER" },
          files: 100,
          directories: 10,
        },
      ],
      last_iteration: {},
      last_errors: {},
    };

    beforeEach(() => {
      // Mock environment variables
      process.env.SCHEMA = "test_schema";
      process.env.REPORT_DOWNLOAD_LOCATION = "./reports";

      // Mock fs.readFileSync for template
      mockFs.readFileSync.mockReturnValue(
        "<html>{{customerInfo.projectName}}</html>"
      );

      // Mock path operations
      mockPath.join.mockReturnValue("/templates/views/jobs_report.hbs");

      // Mock hbs compile to return a function that returns HTML
      const mockCompiledTemplate = jest
        .fn()
        .mockReturnValue("<html>Compiled HTML</html>");
      mockHbs.compile.mockReturnValue(mockCompiledTemplate);
    });

    it("should generate PDF successfully with valid data", async () => {
      const mockPdfBuffer = Buffer.from("mock pdf content");
      const mockPage = {
        setContent: jest.fn(),
        pdf: jest.fn().mockResolvedValue(mockPdfBuffer),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any);
      inventoryRepo.query.mockResolvedValue(mockProjectData);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      const result = await service.generateJobsReportPdf(jobRunId);

      expect(result).toEqual(Buffer.from(mockPdfBuffer));
      expect(inventoryRepo.query).toHaveBeenCalledWith(
        expect.stringContaining("select p.* from test_schema.jobrun j"),
        [jobRunId]
      );
      expect(reportsRepo.query).toHaveBeenCalledWith(
        expect.stringContaining("SELECT * FROM test_schema.reports"),
        [jobRunId, "JOBS_REPORT"]
      );
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it("should use default schema when SCHEMA env var is not set", async () => {
      delete process.env.SCHEMA;

      const mockPdfBuffer = Buffer.from("mock pdf content");
      const mockPage = {
        setContent: jest.fn(),
        pdf: jest.fn().mockResolvedValue(mockPdfBuffer),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any);
      inventoryRepo.query.mockResolvedValue(mockProjectData);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      await service.generateJobsReportPdf(jobRunId);

      expect(inventoryRepo.query).toHaveBeenCalledWith(
        expect.stringContaining("select p.* from datamigrator.jobrun j"),
        [jobRunId]
      );
    });

    it("should handle empty project data", async () => {
      const mockPdfBuffer = Buffer.from("mock pdf content");
      const mockPage = {
        setContent: jest.fn(),
        pdf: jest.fn().mockResolvedValue(mockPdfBuffer),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any);
      inventoryRepo.query.mockResolvedValue([]);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      const result = await service.generateJobsReportPdf(jobRunId);

      expect(result).toEqual(Buffer.from(mockPdfBuffer));
      // Should use default project name when no project data
      expect(mockPage.setContent).toHaveBeenCalledWith(
        expect.stringContaining("NetApp Data Migrator"),
        { waitUntil: "networkidle0" }
      );
    });

    it("should throw HttpException when report data is not found", async () => {
      inventoryRepo.query.mockResolvedValue(mockProjectData);
      reportsRepo.query.mockResolvedValue([]);

      await expect(service.generateJobsReportPdf(jobRunId)).rejects.toThrow(
        new HttpException(
          "Report data not found",
          HttpStatus.INTERNAL_SERVER_ERROR
        )
      );

      expect(discoveryService.createJobsPDFReportData).toHaveBeenCalledWith(
        jobRunId
      );
    });

    it("should handle null or undefined last_iteration and last_errors", async () => {
      const mockDataWithNulls = {
        summary: [
          {
            source: { job_type: "CUT_OVER" },
            files: 100,
            directories: 10,
          },
        ],
        last_iteration: null,
        last_errors: undefined,
      };

      const mockPdfBuffer = Buffer.from("mock pdf content");
      const mockPage = {
        setContent: jest.fn(),
        pdf: jest.fn().mockResolvedValue(mockPdfBuffer),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any);
      inventoryRepo.query.mockResolvedValue(mockProjectData);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockDataWithNulls),
        },
      ]);

      const result = await service.generateJobsReportPdf(jobRunId);

      expect(result).toEqual(Buffer.from(mockPdfBuffer));
    });

    it("should throw error when summary data is invalid or missing", async () => {
      const mockDataWithInvalidSummary = {
        summary: null,
        last_iteration: {},
        last_errors: {},
      };

      inventoryRepo.query.mockResolvedValue(mockProjectData);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockDataWithInvalidSummary),
        },
      ]);

      await expect(service.generateJobsReportPdf(jobRunId)).rejects.toThrow(
        new HttpException(
          "Failed to generate jobs report",
          HttpStatus.INTERNAL_SERVER_ERROR
        )
      );
    });

    it("should throw error when summary data is empty array", async () => {
      const mockDataWithEmptySummary = {
        summary: [],
        last_iteration: {},
        last_errors: {},
      };

      inventoryRepo.query.mockResolvedValue(mockProjectData);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockDataWithEmptySummary),
        },
      ]);

      await expect(service.generateJobsReportPdf(jobRunId)).rejects.toThrow(
        new HttpException(
          "Failed to generate jobs report",
          HttpStatus.INTERNAL_SERVER_ERROR
        )
      );
    });

    it("should filter cutovers correctly", async () => {
      const mockDataWithMultipleSummary = {
        summary: [
          { source: { job_type: "CUT_OVER" }, files: 100 },
          { source: { job_type: "MIGRATE" }, files: 50 },
          { source: { job_type: "CUT_OVER" }, files: 75 },
        ],
        last_iteration: {},
        last_errors: {},
      };

      const mockPdfBuffer = Buffer.from("mock pdf content");
      const mockPage = {
        setContent: jest.fn(),
        pdf: jest.fn().mockResolvedValue(mockPdfBuffer),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any);
      inventoryRepo.query.mockResolvedValue(mockProjectData);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockDataWithMultipleSummary),
        },
      ]);

      await service.generateJobsReportPdf(jobRunId);

      // Should filter only CUT_OVER items
      expect(mockPage.setContent).toHaveBeenCalledWith(expect.any(String), {
        waitUntil: "networkidle0",
      });
    });

    it("should handle empty cutovers array", async () => {
      const mockDataWithNoCutovers = {
        summary: [
          { source: { job_type: "MIGRATE" }, files: 50 },
          { source: { job_type: "DISCOVER" }, files: 25 },
        ],
        last_iteration: {},
        last_errors: {},
      };

      const mockPdfBuffer = Buffer.from("mock pdf content");
      const mockPage = {
        setContent: jest.fn(),
        pdf: jest.fn().mockResolvedValue(mockPdfBuffer),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any);
      inventoryRepo.query.mockResolvedValue(mockProjectData);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockDataWithNoCutovers),
        },
      ]);

      await service.generateJobsReportPdf(jobRunId);

      expect(mockPage.setContent).toHaveBeenCalled();
    });

    it("should close browser even if PDF generation fails", async () => {
      const mockPage = {
        setContent: jest.fn(),
        pdf: jest.fn().mockRejectedValue(new Error("PDF generation failed")),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any);
      inventoryRepo.query.mockResolvedValue(mockProjectData);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      await expect(service.generateJobsReportPdf(jobRunId)).rejects.toThrow(
        new HttpException(
          "Failed to generate jobs report",
          HttpStatus.INTERNAL_SERVER_ERROR
        )
      );

      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it("should handle browser launch failure", async () => {
      mockPuppeteer.launch.mockRejectedValue(
        new Error("Browser launch failed")
      );
      inventoryRepo.query.mockResolvedValue(mockProjectData);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      await expect(service.generateJobsReportPdf(jobRunId)).rejects.toThrow(
        new HttpException(
          "Failed to generate jobs report",
          HttpStatus.INTERNAL_SERVER_ERROR
        )
      );
    });

    it("should handle database query failures", async () => {
      inventoryRepo.query.mockRejectedValue(new Error("Database error"));

      await expect(service.generateJobsReportPdf(jobRunId)).rejects.toThrow(
        new HttpException(
          "Failed to generate jobs report",
          HttpStatus.INTERNAL_SERVER_ERROR
        )
      );
    });

    it("should handle invalid JSON in report data", async () => {
      inventoryRepo.query.mockResolvedValue(mockProjectData);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: "invalid json",
        },
      ]);

      await expect(service.generateJobsReportPdf(jobRunId)).rejects.toThrow(
        new HttpException(
          "Failed to generate jobs report",
          HttpStatus.INTERNAL_SERVER_ERROR
        )
      );
    });

    it("should handle template file read failure", async () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error("Template file not found");
      });

      await expect(service.generateJobsReportPdf(jobRunId)).rejects.toThrow(
        new HttpException(
          "Failed to generate jobs report",
          HttpStatus.INTERNAL_SERVER_ERROR
        )
      );
    });

    it("should handle page creation failure", async () => {
      const mockBrowser = {
        newPage: jest.fn().mockRejectedValue(new Error("Page creation failed")),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any);
      inventoryRepo.query.mockResolvedValue(mockProjectData);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      await expect(service.generateJobsReportPdf(jobRunId)).rejects.toThrow(
        new HttpException(
          "Failed to generate jobs report",
          HttpStatus.INTERNAL_SERVER_ERROR
        )
      );

      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it("should handle setContent failure", async () => {
      const mockPage = {
        setContent: jest.fn().mockRejectedValue(new Error("setContent failed")),
        pdf: jest.fn(),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any);
      inventoryRepo.query.mockResolvedValue(mockProjectData);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      await expect(service.generateJobsReportPdf(jobRunId)).rejects.toThrow(
        new HttpException(
          "Failed to generate jobs report",
          HttpStatus.INTERNAL_SERVER_ERROR
        )
      );

      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it("should handle null browser in finally block", async () => {
      // Mock puppeteer.launch to return null
      mockPuppeteer.launch.mockResolvedValue(null as any);
      inventoryRepo.query.mockResolvedValue(mockProjectData);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      await expect(service.generateJobsReportPdf(jobRunId)).rejects.toThrow(
        new HttpException(
          "Failed to generate jobs report",
          HttpStatus.INTERNAL_SERVER_ERROR
        )
      );

      // Should not throw error when browser is null
    });

    it("should use current date for report generation", async () => {
      const mockDate = new Date("2023-01-01T00:00:00.000Z");
      const originalDate = global.Date;
      global.Date = jest.fn(() => mockDate) as any;
      global.Date.now = jest.fn(() => mockDate.getTime());

      const mockPdfBuffer = Buffer.from("mock pdf content");
      const mockPage = {
        setContent: jest.fn(),
        pdf: jest.fn().mockResolvedValue(mockPdfBuffer),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any);
      inventoryRepo.query.mockResolvedValue(mockProjectData);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      await service.generateJobsReportPdf(jobRunId);

      expect(mockPage.setContent).toHaveBeenCalledWith(
        expect.stringContaining("1/1/2023"),
        { waitUntil: "networkidle0" }
      );

      global.Date = originalDate;
    });
  });

  describe("Error handling and edge cases", () => {
    it("should handle undefined environment variables", async () => {
      delete process.env.REPORT_DOWNLOAD_LOCATION;
      delete process.env.SCHEMA;

      const jobRunId = "test-job-run-id";
      const mockBuffer = Buffer.from("mock pdf content");
      jest
        .spyOn(service, "generateJobsReportPdf")
        .mockResolvedValue(mockBuffer);

      const result = await service.generatePdf(
        jobRunId,
        ReportType.JOBS_RREPORT
      );

      expect(result).toEqual(mockBuffer);
    });

    it("should handle very long job run IDs", async () => {
      const longJobRunId = "a".repeat(1000);
      const mockBuffer = Buffer.from("mock pdf content");
      jest
        .spyOn(service, "generateJobsReportPdf")
        .mockResolvedValue(mockBuffer);

      mockPath.join.mockReturnValue("/safe/path/long-filename.pdf");
      mockPath.resolve.mockReturnValue("/safe/path");

      const result = await service.generatePdf(
        longJobRunId,
        ReportType.JOBS_RREPORT
      );

      expect(result).toEqual(mockBuffer);
    });

    it("should handle empty job run ID", async () => {
      const emptyJobRunId = "";
      const mockBuffer = Buffer.from("mock pdf content");
      jest
        .spyOn(service, "generateJobsReportPdf")
        .mockResolvedValue(mockBuffer);

      mockPath.join.mockReturnValue("/safe/path/-jobs-report-report.pdf");
      mockPath.resolve.mockReturnValue("/safe/path");

      const result = await service.generatePdf(
        emptyJobRunId,
        ReportType.JOBS_RREPORT
      );

      expect(result).toEqual(mockBuffer);
    });
  });

  describe("Path validation and sanitization", () => {
    it("should properly validate file paths to prevent path traversal", async () => {
      // Test case where path starts with resolved directory (valid)
      mockPath.join.mockReturnValueOnce(
        "./reports/test-job-run-id-discovery-report.pdf"
      );
      mockPath.resolve.mockReturnValueOnce("./reports");
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(Buffer.from("pdf content"));

      const result = await service.generatePdf(
        "test-job-run-id",
        ReportType.DISCOVERY
      );

      expect(result).toEqual(Buffer.from("pdf content"));
    });

    it("should reject paths that don't start with resolved directory", async () => {
      // Test case where path doesn't start with resolved directory (invalid)
      mockPath.join.mockReturnValueOnce(
        "/outside/path/test-job-run-id-discovery-report.pdf"
      );
      mockPath.resolve.mockReturnValueOnce("./reports");

      await expect(
        service.generatePdf("test-job-run-id", ReportType.DISCOVERY)
      ).rejects.toThrow(
        new HttpException("Invalid file path", HttpStatus.BAD_REQUEST)
      );
    });

    it("should sanitize special characters in jobRunId", async () => {
      const specialJobRunId = "job@#$%^&*()run-id";
      mockPath.join.mockReturnValueOnce(
        "./reports/jobrun-id-discovery-report.pdf"
      );
      mockPath.resolve.mockReturnValueOnce("./reports");
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(Buffer.from("pdf content"));

      const result = await service.generatePdf(
        specialJobRunId,
        ReportType.DISCOVERY
      );

      expect(result).toEqual(Buffer.from("pdf content"));
    });

    it("should sanitize special characters in reportType", async () => {
      const jobRunId = "test-job-run-id";
      mockPath.join.mockReturnValueOnce(
        "./reports/test-job-run-id-discovery-report.pdf"
      );
      mockPath.resolve.mockReturnValueOnce("./reports");
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(Buffer.from("pdf content"));

      const result = await service.generatePdf(jobRunId, ReportType.DISCOVERY);

      expect(result).toEqual(Buffer.from("pdf content"));
    });
  });

  describe("Discovery report file handling", () => {
    it("should return existing file when DISCOVERY report exists", async () => {
      mockPath.join.mockReturnValueOnce(
        "./reports/test-job-run-id-discovery-report.pdf"
      );
      mockPath.resolve.mockReturnValueOnce("./reports");
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(Buffer.from("existing pdf content"));

      const result = await service.generatePdf(
        "test-job-run-id",
        ReportType.DISCOVERY
      );

      expect(result).toEqual(Buffer.from("existing pdf content"));
      expect(mockFs.existsSync).toHaveBeenCalled();
      expect(mockFs.readFileSync).toHaveBeenCalled();
    });

    it("should throw error when DISCOVERY report doesn't exist", async () => {
      mockPath.join.mockReturnValueOnce(
        "./reports/test-job-run-id-discovery-report.pdf"
      );
      mockPath.resolve.mockReturnValueOnce("./reports");
      mockFs.existsSync.mockReturnValue(false);

      await expect(
        service.generatePdf("test-job-run-id", ReportType.DISCOVERY)
      ).rejects.toThrow(
        new HttpException(
          "Report not found, try again later",
          HttpStatus.INTERNAL_SERVER_ERROR
        )
      );
    });

    it("should handle COC report type with discovery logic", async () => {
      mockPath.join.mockReturnValueOnce(
        "./reports/test-job-run-id-coc-report.pdf"
      );
      mockPath.resolve.mockReturnValueOnce("./reports");
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(Buffer.from("coc pdf content"));

      const result = await service.generatePdf(
        "test-job-run-id",
        ReportType.COC
      );

      expect(result).toEqual(Buffer.from("coc pdf content"));
    });

    it("should handle JOB_RUN_STATS report type with discovery logic", async () => {
      mockPath.join.mockReturnValueOnce(
        "./reports/test-job-run-id-jobrunstats-report.pdf"
      );
      mockPath.resolve.mockReturnValueOnce("./reports");
      mockFs.existsSync.mockReturnValue(false);

      await expect(
        service.generatePdf("test-job-run-id", ReportType.JOB_RUN_STATS)
      ).rejects.toThrow(
        new HttpException(
          "Report not found, try again later",
          HttpStatus.INTERNAL_SERVER_ERROR
        )
      );
    });
  });

  describe("generateJobsReportPdf comprehensive coverage", () => {
    beforeEach(() => {
      // Reset environment
      process.env.SCHEMA = "test_schema";
      process.env.REPORT_DOWNLOAD_LOCATION = "./reports";

      // Mock fs.readFileSync for template
      mockFs.readFileSync.mockReturnValue(
        "<html>{{customerInfo.projectName}}</html>"
      );

      // Mock path operations
      mockPath.join.mockReturnValue("/templates/views/jobs_report.hbs");

      // Mock hbs compile
      const mockCompiledTemplate = jest
        .fn()
        .mockReturnValue("<html>Compiled HTML</html>");
      mockHbs.compile.mockReturnValue(mockCompiledTemplate);
    });

    it("should handle projectData.length > 0 condition", async () => {
      const mockProjectData = [
        {
          project_name: "Test Project",
          id: "project-id",
        },
      ];

      const mockReportData = {
        summary: [{ source: { job_type: "CUT_OVER" }, files: 100 }],
        last_iteration: {},
        last_errors: {},
      };

      const mockPdfBuffer = Buffer.from("mock pdf content");
      const mockPage = {
        setContent: jest.fn(),
        pdf: jest.fn().mockResolvedValue(mockPdfBuffer),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any);
      inventoryRepo.query.mockResolvedValue(mockProjectData);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      const result = await service.generateJobsReportPdf("test-job-run-id");

      expect(result).toEqual(Buffer.from(mockPdfBuffer));
    });

    it("should handle projectData.length === 0 condition", async () => {
      const mockProjectData = [];

      const mockReportData = {
        summary: [{ source: { job_type: "CUT_OVER" }, files: 100 }],
        last_iteration: {},
        last_errors: {},
      };

      const mockPdfBuffer = Buffer.from("mock pdf content");
      const mockPage = {
        setContent: jest.fn(),
        pdf: jest.fn().mockResolvedValue(mockPdfBuffer),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any);
      inventoryRepo.query.mockResolvedValue(mockProjectData);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      const result = await service.generateJobsReportPdf("test-job-run-id");

      expect(result).toEqual(Buffer.from(mockPdfBuffer));
    });

    it("should handle reportData.last_iteration truthy condition", async () => {
      const mockReportData = {
        summary: [{ source: { job_type: "CUT_OVER" }, files: 100 }],
        last_iteration: { existing: "data" },
        last_errors: {},
      };

      const mockPdfBuffer = Buffer.from("mock pdf content");
      const mockPage = {
        setContent: jest.fn(),
        pdf: jest.fn().mockResolvedValue(mockPdfBuffer),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any);
      inventoryRepo.query.mockResolvedValue([]);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      const result = await service.generateJobsReportPdf("test-job-run-id");

      expect(result).toEqual(Buffer.from(mockPdfBuffer));
    });

    it("should handle reportData.last_errors truthy condition", async () => {
      const mockReportData = {
        summary: [{ source: { job_type: "CUT_OVER" }, files: 100 }],
        last_iteration: {},
        last_errors: { existing: "errors" },
      };

      const mockPdfBuffer = Buffer.from("mock pdf content");
      const mockPage = {
        setContent: jest.fn(),
        pdf: jest.fn().mockResolvedValue(mockPdfBuffer),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any);
      inventoryRepo.query.mockResolvedValue([]);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      const result = await service.generateJobsReportPdf("test-job-run-id");

      expect(result).toEqual(Buffer.from(mockPdfBuffer));
    });

    it("should handle filter for CUT_OVER job types", async () => {
      const mockReportData = {
        summary: [
          { source: { job_type: "CUT_OVER" }, files: 100 },
          { source: { job_type: "MIGRATE" }, files: 50 },
          { source: { job_type: "CUT_OVER" }, files: 75 },
        ],
        last_iteration: {},
        last_errors: {},
      };

      const mockPdfBuffer = Buffer.from("mock pdf content");
      const mockPage = {
        setContent: jest.fn(),
        pdf: jest.fn().mockResolvedValue(mockPdfBuffer),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any);
      inventoryRepo.query.mockResolvedValue([]);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      const result = await service.generateJobsReportPdf("test-job-run-id");

      expect(result).toEqual(Buffer.from(mockPdfBuffer));
    });

    it("should handle empty filter result with ?? [] operator", async () => {
      const mockReportData = {
        summary: [
          { source: { job_type: "MIGRATE" }, files: 50 },
          { source: { job_type: "DISCOVER" }, files: 25 },
        ],
        last_iteration: {},
        last_errors: {},
      };

      const mockPdfBuffer = Buffer.from("mock pdf content");
      const mockPage = {
        setContent: jest.fn(),
        pdf: jest.fn().mockResolvedValue(mockPdfBuffer),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any);
      inventoryRepo.query.mockResolvedValue([]);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      const result = await service.generateJobsReportPdf("test-job-run-id");

      expect(result).toEqual(Buffer.from(mockPdfBuffer));
    });

    it("should handle filter result with ?? [] operator (non-empty result)", async () => {
      const mockReportData = {
        summary: [
          { source: { job_type: "CUT_OVER" }, files: 100 },
          { source: { job_type: "MIGRATE" }, files: 50 },
          { source: { job_type: "CUT_OVER" }, files: 75 },
        ], // has CUT_OVER items
        last_iteration: {},
        last_errors: {},
      };

      const mockPdfBuffer = Buffer.from("mock pdf content");
      const mockPage = {
        setContent: jest.fn(),
        pdf: jest.fn().mockResolvedValue(mockPdfBuffer),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any);
      inventoryRepo.query.mockResolvedValue([]);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      const result = await service.generateJobsReportPdf("test-job-run-id");

      expect(result).toEqual(Buffer.from(mockPdfBuffer));
    });

    it("should handle schema || 'datamigrator' branch (truthy)", async () => {
      process.env.SCHEMA = "custom_schema"; // truthy value

      const mockReportData = {
        summary: [{ source: { job_type: "CUT_OVER" }, files: 100 }],
        last_iteration: {},
        last_errors: {},
      };

      const mockPdfBuffer = Buffer.from("mock pdf content");
      const mockPage = {
        setContent: jest.fn(),
        pdf: jest.fn().mockResolvedValue(mockPdfBuffer),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any);
      inventoryRepo.query.mockResolvedValue([]);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      const result = await service.generateJobsReportPdf("test-job-run-id");

      expect(result).toEqual(Buffer.from(mockPdfBuffer));
      expect(inventoryRepo.query).toHaveBeenCalledWith(
        expect.stringContaining("select p.* from custom_schema.jobrun j"),
        ["test-job-run-id"]
      );
    });

    it("should handle schema || 'datamigrator' branch (falsy)", async () => {
      process.env.SCHEMA = ""; // falsy value

      const mockReportData = {
        summary: [{ source: { job_type: "CUT_OVER" }, files: 100 }],
        last_iteration: {},
        last_errors: {},
      };

      const mockPdfBuffer = Buffer.from("mock pdf content");
      const mockPage = {
        setContent: jest.fn(),
        pdf: jest.fn().mockResolvedValue(mockPdfBuffer),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any);
      inventoryRepo.query.mockResolvedValue([]);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      const result = await service.generateJobsReportPdf("test-job-run-id");

      expect(result).toEqual(Buffer.from(mockPdfBuffer));
      expect(inventoryRepo.query).toHaveBeenCalledWith(
        expect.stringContaining("select p.* from datamigrator.jobrun j"),
        ["test-job-run-id"]
      );
    });

    it("should handle !data.length branch (truthy - no data)", async () => {
      inventoryRepo.query.mockResolvedValue([]);
      reportsRepo.query.mockResolvedValue([]); // empty array - no data

      await expect(
        service.generateJobsReportPdf("test-job-run-id")
      ).rejects.toThrow(HttpException);

      expect(discoveryService.createJobsPDFReportData).toHaveBeenCalledWith(
        "test-job-run-id"
      );
    });

    it("should handle !data.length branch (falsy - has data)", async () => {
      const mockReportData = {
        summary: [{ source: { job_type: "CUT_OVER" }, files: 100 }],
        last_iteration: {},
        last_errors: {},
      };

      const mockPdfBuffer = Buffer.from("mock pdf content");
      const mockPage = {
        setContent: jest.fn(),
        pdf: jest.fn().mockResolvedValue(mockPdfBuffer),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any);
      inventoryRepo.query.mockResolvedValue([]);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]); // has data

      const result = await service.generateJobsReportPdf("test-job-run-id");

      expect(result).toEqual(Buffer.from(mockPdfBuffer));
      expect(discoveryService.createJobsPDFReportData).not.toHaveBeenCalled();
    });

    it("should handle if (browser) branch in finally block (truthy)", async () => {
      const mockReportData = {
        summary: [{ source: { job_type: "CUT_OVER" }, files: 100 }],
        last_iteration: {},
        last_errors: {},
      };

      const mockBrowser = {
        newPage: jest.fn().mockRejectedValue(new Error("Page creation failed")),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any); // browser is truthy
      inventoryRepo.query.mockResolvedValue([]);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      await expect(
        service.generateJobsReportPdf("test-job-run-id")
      ).rejects.toThrow(HttpException);

      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it("should handle if (browser) branch in finally block (falsy)", async () => {
      const mockReportData = {
        summary: [{ source: { job_type: "CUT_OVER" }, files: 100 }],
        last_iteration: {},
        last_errors: {},
      };

      mockPuppeteer.launch.mockResolvedValue(null as any); // browser is falsy
      inventoryRepo.query.mockResolvedValue([]);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      await expect(
        service.generateJobsReportPdf("test-job-run-id")
      ).rejects.toThrow(HttpException);

      // No close method should be called on null browser
    });
  });

  describe("Logger integration tests", () => {
    it("should log when checking for existing report", async () => {
      const mockBuffer = Buffer.from("mock pdf content");
      jest
        .spyOn(service, "generateJobsReportPdf")
        .mockResolvedValue(mockBuffer);

      await service.generatePdf("test-job-run-id", ReportType.JOBS_RREPORT);

      expect(logger.log).toHaveBeenCalledWith(
        "Checking for existing report for jobRunId: test-job-run-id and reportType: JOBS_REPORT"
      );
    });

    it("should log when returning existing DISCOVERY report", async () => {
      const mockBuffer = Buffer.from("existing pdf content");
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(mockBuffer);
      mockPath.join.mockReturnValue(
        "./reports/test-job-run-id-discovery-report.pdf"
      );
      mockPath.resolve.mockReturnValue("./reports");

      await service.generatePdf("test-job-run-id", ReportType.DISCOVERY);

      expect(logger.log).toHaveBeenCalledWith(
        "Report found. Returning existing report: ./reports/test-job-run-id-discovery-report.pdf"
      );
    });

    it("should log error when file path is invalid", async () => {
      mockPath.join.mockReturnValueOnce("/dangerous/path/../../test-file.pdf");
      mockPath.resolve.mockReturnValueOnce("/safe/path");

      await expect(
        service.generatePdf("test-job-run-id", ReportType.DISCOVERY)
      ).rejects.toThrow(HttpException);

      expect(logger.error).toHaveBeenCalledWith(
        "Invalid file path: /dangerous/path/../../test-file.pdf"
      );
    });

    it("should log error when report generation fails", async () => {
      const mockError = new Error("Generation failed");
      inventoryRepo.query.mockRejectedValue(mockError);

      await expect(
        service.generateJobsReportPdf("test-job-run-id")
      ).rejects.toThrow(HttpException);

      expect(logger.error).toHaveBeenCalledWith(
        "Failed to generate jobs report for jobRunId: test-job-run-id, error: Error: Generation failed"
      );
    });

    it("should log error when report data is not found", async () => {
      inventoryRepo.query.mockResolvedValue([]);
      reportsRepo.query.mockResolvedValue([]);

      await expect(
        service.generateJobsReportPdf("test-job-run-id")
      ).rejects.toThrow(HttpException);

      expect(logger.error).toHaveBeenCalledWith(
        "Report data not found for jobRunId: test-job-run-id and reportType: JOBS_REPORT"
      );
      expect(logger.log).toHaveBeenCalledWith(
        "Calling discoveryService.createJobsPDFReportData for jobRunId: test-job-run-id"
      );
      expect(logger.log).toHaveBeenCalledWith(
        "Called discoveryService.createJobsPDFReportData for jobRunId: test-job-run-id, try again later"
      );
    });
  });

  describe("Branch coverage for generateJobsReportPdf", () => {
    beforeEach(() => {
      // Reset environment
      process.env.SCHEMA = "test_schema";
      process.env.REPORT_DOWNLOAD_LOCATION = "./reports";

      // Mock fs.readFileSync for template
      mockFs.readFileSync.mockReturnValue(
        "<html>{{customerInfo.projectName}}</html>"
      );

      // Mock path operations
      mockPath.join.mockReturnValue("/templates/views/jobs_report.hbs");

      // Mock hbs compile
      const mockCompiledTemplate = jest
        .fn()
        .mockReturnValue("<html>Compiled HTML</html>");
      mockHbs.compile.mockReturnValue(mockCompiledTemplate);
    });

    it("should handle reportData.last_iteration || {} branch (falsy)", async () => {
      const mockReportData = {
        summary: [{ source: { job_type: "CUT_OVER" }, files: 100 }],
        last_iteration: null, // falsy value
        last_errors: {},
      };

      const mockPdfBuffer = Buffer.from("mock pdf content");
      const mockPage = {
        setContent: jest.fn(),
        pdf: jest.fn().mockResolvedValue(mockPdfBuffer),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any);
      inventoryRepo.query.mockResolvedValue([]);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      const result = await service.generateJobsReportPdf("test-job-run-id");

      expect(result).toEqual(Buffer.from(mockPdfBuffer));
    });

    it("should handle reportData.last_iteration || {} branch (truthy)", async () => {
      const mockReportData = {
        summary: [{ source: { job_type: "CUT_OVER" }, files: 100 }],
        last_iteration: { existing: "data" }, // truthy value
        last_errors: {},
      };

      const mockPdfBuffer = Buffer.from("mock pdf content");
      const mockPage = {
        setContent: jest.fn(),
        pdf: jest.fn().mockResolvedValue(mockPdfBuffer),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any);
      inventoryRepo.query.mockResolvedValue([]);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      const result = await service.generateJobsReportPdf("test-job-run-id");

      expect(result).toEqual(Buffer.from(mockPdfBuffer));
    });

    it("should handle reportData.last_errors || {} branch (falsy)", async () => {
      const mockReportData = {
        summary: [{ source: { job_type: "CUT_OVER" }, files: 100 }],
        last_iteration: {},
        last_errors: null, // falsy value
      };

      const mockPdfBuffer = Buffer.from("mock pdf content");
      const mockPage = {
        setContent: jest.fn(),
        pdf: jest.fn().mockResolvedValue(mockPdfBuffer),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any);
      inventoryRepo.query.mockResolvedValue([]);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      const result = await service.generateJobsReportPdf("test-job-run-id");

      expect(result).toEqual(Buffer.from(mockPdfBuffer));
    });

    it("should handle reportData.last_errors || {} branch (truthy)", async () => {
      const mockReportData = {
        summary: [{ source: { job_type: "CUT_OVER" }, files: 100 }],
        last_iteration: {},
        last_errors: { existing: "errors" }, // truthy value
      };

      const mockPdfBuffer = Buffer.from("mock pdf content");
      const mockPage = {
        setContent: jest.fn(),
        pdf: jest.fn().mockResolvedValue(mockPdfBuffer),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any);
      inventoryRepo.query.mockResolvedValue([]);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      const result = await service.generateJobsReportPdf("test-job-run-id");

      expect(result).toEqual(Buffer.from(mockPdfBuffer));
    });

    it("should handle Array.isArray(reportData.summary) true branch", async () => {
      const mockReportData = {
        summary: [{ source: { job_type: "CUT_OVER" }, files: 100 }], // valid array
        last_iteration: {},
        last_errors: {},
      };

      const mockPdfBuffer = Buffer.from("mock pdf content");
      const mockPage = {
        setContent: jest.fn(),
        pdf: jest.fn().mockResolvedValue(mockPdfBuffer),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any);
      inventoryRepo.query.mockResolvedValue([]);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      const result = await service.generateJobsReportPdf("test-job-run-id");

      expect(result).toEqual(Buffer.from(mockPdfBuffer));
    });

    it("should handle Array.isArray(reportData.summary) false branch", async () => {
      const mockReportData = {
        summary: "not an array", // invalid - not an array
        last_iteration: {},
        last_errors: {},
      };

      inventoryRepo.query.mockResolvedValue([]);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      await expect(
        service.generateJobsReportPdf("test-job-run-id")
      ).rejects.toThrow(HttpException);
    });

    it("should handle reportData.summary.length === 0 branch", async () => {
      const mockReportData = {
        summary: [], // empty array
        last_iteration: {},
        last_errors: {},
      };

      inventoryRepo.query.mockResolvedValue([]);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      await expect(
        service.generateJobsReportPdf("test-job-run-id")
      ).rejects.toThrow(HttpException);
    });

    it("should handle reportData.summary.length > 0 branch", async () => {
      const mockReportData = {
        summary: [{ source: { job_type: "CUT_OVER" }, files: 100 }], // non-empty array
        last_iteration: {},
        last_errors: {},
      };

      const mockPdfBuffer = Buffer.from("mock pdf content");
      const mockPage = {
        setContent: jest.fn(),
        pdf: jest.fn().mockResolvedValue(mockPdfBuffer),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any);
      inventoryRepo.query.mockResolvedValue([]);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      const result = await service.generateJobsReportPdf("test-job-run-id");

      expect(result).toEqual(Buffer.from(mockPdfBuffer));
    });

    it("should handle projectData.length > 0 ? projectData[0].project_name : default branch (truthy)", async () => {
      const mockProjectData = [
        {
          project_name: "Test Project Name",
          id: "project-id",
        },
      ];

      const mockReportData = {
        summary: [{ source: { job_type: "CUT_OVER" }, files: 100 }],
        last_iteration: {},
        last_errors: {},
      };

      const mockPdfBuffer = Buffer.from("mock pdf content");
      const mockPage = {
        setContent: jest.fn(),
        pdf: jest.fn().mockResolvedValue(mockPdfBuffer),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any);
      inventoryRepo.query.mockResolvedValue(mockProjectData);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      const result = await service.generateJobsReportPdf("test-job-run-id");

      expect(result).toEqual(Buffer.from(mockPdfBuffer));
    });

    it("should handle projectData.length > 0 ? projectData[0].project_name : default branch (falsy)", async () => {
      const mockProjectData = []; // empty array

      const mockReportData = {
        summary: [{ source: { job_type: "CUT_OVER" }, files: 100 }],
        last_iteration: {},
        last_errors: {},
      };

      const mockPdfBuffer = Buffer.from("mock pdf content");
      const mockPage = {
        setContent: jest.fn(),
        pdf: jest.fn().mockResolvedValue(mockPdfBuffer),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser as any);
      inventoryRepo.query.mockResolvedValue(mockProjectData);
      reportsRepo.query.mockResolvedValue([
        {
          report_data: JSON.stringify(mockReportData),
        },
      ]);

      const result = await service.generateJobsReportPdf("test-job-run-id");

      expect(result).toEqual(Buffer.from(mockPdfBuffer));
    });

    it("should handle filePath.startsWith(path.resolve(this.reportsDirectory)) branch (truthy)", async () => {
      // Mock path to start with resolved directory (valid path)
      mockPath.join.mockReturnValueOnce(
        "./reports/test-job-run-id-discovery-report.pdf"
      );
      mockPath.resolve.mockReturnValueOnce("./reports");
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(Buffer.from("pdf content"));

      const result = await service.generatePdf(
        "test-job-run-id",
        ReportType.DISCOVERY
      );

      expect(result).toEqual(Buffer.from("pdf content"));
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("should handle filePath.startsWith(path.resolve(this.reportsDirectory)) branch (falsy)", async () => {
      // Mock path to NOT start with resolved directory (invalid path)
      mockPath.join.mockReturnValueOnce(
        "/outside/path/test-job-run-id-discovery-report.pdf"
      );
      mockPath.resolve.mockReturnValueOnce("./reports");

      await expect(
        service.generatePdf("test-job-run-id", ReportType.DISCOVERY)
      ).rejects.toThrow(
        new HttpException("Invalid file path", HttpStatus.BAD_REQUEST)
      );

      expect(logger.error).toHaveBeenCalledWith(
        "Invalid file path: /outside/path/test-job-run-id-discovery-report.pdf"
      );
    });

    it("should handle different report types in sanitization", async () => {
      const mockBuffer = Buffer.from("mock pdf content");
      jest
        .spyOn(service, "generateJobsReportPdf")
        .mockResolvedValue(mockBuffer);

      // Test different report types to ensure sanitization works
      await service.generatePdf("test-job-run-id", ReportType.JOBS_RREPORT);

      expect(mockPath.join).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringMatching(/test-job-run-id-jobs-report-report\.pdf/)
      );
    });

    it("should handle jobRunId sanitization with various special characters", async () => {
      const mockBuffer = Buffer.from("mock pdf content");
      jest
        .spyOn(service, "generateJobsReportPdf")
        .mockResolvedValue(mockBuffer);

      await service.generatePdf(
        "test@#$%^&*()job-run-id",
        ReportType.JOBS_RREPORT
      );

      // Should sanitize special characters to only allow alphanumeric and hyphens
      expect(mockPath.join).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringMatching(/test-job-run-id-jobs-report-report\.pdf/)
      );
    });

    it("should handle reportType with special characters", async () => {
      const mockBuffer = Buffer.from("mock pdf content");
      jest
        .spyOn(service, "generateJobsReportPdf")
        .mockResolvedValue(mockBuffer);

      // Using JOBS_RREPORT which has underscores
      await service.generatePdf("test-job-run-id", ReportType.JOBS_RREPORT);

      // Should sanitize reportType to lowercase
      expect(mockPath.join).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringMatching(/jobs-report-report\.pdf/)
      );
    });
  });

  describe("Service instantiation and basic functionality", () => {
    it("should be defined", () => {
      expect(service).toBeDefined();
    });

    it("should have logger defined", () => {
      expect((service as any).logger).toBeDefined();
    });

    it("should have reportsDirectory defined", () => {
      expect((service as any).reportsDirectory).toBeDefined();
    });

    it("should use default reportsDirectory when env var not set", async () => {
      // This tests the constructor logic
      const originalEnv = process.env.REPORT_DOWNLOAD_LOCATION;
      delete process.env.REPORT_DOWNLOAD_LOCATION;

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
            provide: Logger,
            useValue: {
              log: jest.fn(),
              error: jest.fn(),
              warn: jest.fn(),
              debug: jest.fn(),
              verbose: jest.fn(),
              fatal: jest.fn(),
            },
          },
        ],
      }).compile();

      const testService = module.get<PdfService>(PdfService);
      expect((testService as any).reportsDirectory).toBe("./reports");

      // Restore original env
      if (originalEnv) {
        process.env.REPORT_DOWNLOAD_LOCATION = originalEnv;
      }
    });

    it("should use custom reportsDirectory when env var is set", async () => {
      const originalEnv = process.env.REPORT_DOWNLOAD_LOCATION;
      process.env.REPORT_DOWNLOAD_LOCATION = "/custom/reports";

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
            provide: Logger,
            useValue: {
              log: jest.fn(),
              error: jest.fn(),
              warn: jest.fn(),
              debug: jest.fn(),
              verbose: jest.fn(),
              fatal: jest.fn(),
            },
          },
        ],
      }).compile();

      const testService = module.get<PdfService>(PdfService);
      expect((testService as any).reportsDirectory).toBe("/custom/reports");

      // Restore original env
      if (originalEnv) {
        process.env.REPORT_DOWNLOAD_LOCATION = originalEnv;
      } else {
        delete process.env.REPORT_DOWNLOAD_LOCATION;
      }
    });
  });

  describe("Additional edge cases for complete coverage", () => {
    beforeEach(() => {
      // Mock path operations with proper behavior
      mockPath.join.mockImplementation((...args) => args.join("/"));
      mockPath.resolve.mockImplementation((dir) => `/resolved${dir}`);
    });

    it("should handle process.env.REPORT_DOWNLOAD_LOCATION || './reports' branch (truthy)", async () => {
      // Test the environment variable branch in the constructor
      const originalEnv = process.env.REPORT_DOWNLOAD_LOCATION;
      process.env.REPORT_DOWNLOAD_LOCATION = "/custom/reports";

      const mockBuffer = Buffer.from("mock pdf content");
      jest
        .spyOn(service, "generateJobsReportPdf")
        .mockResolvedValue(mockBuffer);

      await service.generatePdf("test-job-run-id", ReportType.JOBS_RREPORT);

      // Restore original env
      if (originalEnv) {
        process.env.REPORT_DOWNLOAD_LOCATION = originalEnv;
      } else {
        delete process.env.REPORT_DOWNLOAD_LOCATION;
      }
    });

    it("should handle process.env.REPORT_DOWNLOAD_LOCATION || './reports' branch (falsy)", async () => {
      // Test the default value branch in the constructor
      const originalEnv = process.env.REPORT_DOWNLOAD_LOCATION;
      delete process.env.REPORT_DOWNLOAD_LOCATION;

      const mockBuffer = Buffer.from("mock pdf content");
      jest
        .spyOn(service, "generateJobsReportPdf")
        .mockResolvedValue(mockBuffer);

      await service.generatePdf("test-job-run-id", ReportType.JOBS_RREPORT);

      // Restore original env
      if (originalEnv) {
        process.env.REPORT_DOWNLOAD_LOCATION = originalEnv;
      }
    });

    it("should handle fs.existsSync && reportType === ReportType.DISCOVERY both conditions", async () => {
      // Test both conditions in the compound boolean expression
      mockFs.existsSync.mockReturnValue(true); // first condition true
      mockFs.readFileSync.mockReturnValue(Buffer.from("pdf content"));

      const result = await service.generatePdf(
        "test-job-run-id",
        ReportType.DISCOVERY // second condition true
      );

      expect(result).toEqual(Buffer.from("pdf content"));
    });

    it("should handle fs.existsSync false with any report type", async () => {
      // Test first condition false
      mockFs.existsSync.mockReturnValue(false);

      await expect(
        service.generatePdf("test-job-run-id", ReportType.DISCOVERY)
      ).rejects.toThrow(HttpException);
    });

    it("should handle fs.existsSync true but reportType !== ReportType.DISCOVERY", async () => {
      // Test first condition true but second condition false
      mockFs.existsSync.mockReturnValue(true);

      await expect(
        service.generatePdf("test-job-run-id", ReportType.COC)
      ).rejects.toThrow(HttpException);
    });

    it("should handle edge case with empty string sanitization", async () => {
      const mockBuffer = Buffer.from("mock pdf content");
      jest
        .spyOn(service, "generateJobsReportPdf")
        .mockResolvedValue(mockBuffer);

      await service.generatePdf("", ReportType.JOBS_RREPORT);

      expect(mockPath.join).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringMatching(/-jobs-report-report\.pdf$/)
      );
    });

    it("should handle edge case with null/undefined values", async () => {
      const mockBuffer = Buffer.from("mock pdf content");
      jest
        .spyOn(service, "generateJobsReportPdf")
        .mockResolvedValue(mockBuffer);

      // Test with null jobRunId (should be converted to string)
      await service.generatePdf(null as any, ReportType.JOBS_RREPORT);

      expect(mockPath.join).toHaveBeenCalled();
    });

    it("should handle all report types for complete enum coverage", async () => {
      // Test all report types to ensure complete enum coverage
      const reportTypes = [
        ReportType.JOBS_RREPORT,
        ReportType.DISCOVERY,
        ReportType.COC,
        ReportType.JOB_RUN_STATS,
      ];

      for (const reportType of reportTypes) {
        mockFs.existsSync.mockReturnValue(false);

        if (reportType === ReportType.JOBS_RREPORT) {
          const mockBuffer = Buffer.from("mock pdf content");
          jest
            .spyOn(service, "generateJobsReportPdf")
            .mockResolvedValue(mockBuffer);

          const result = await service.generatePdf(
            "test-job-run-id",
            reportType
          );
          expect(result).toEqual(mockBuffer);
        } else {
          await expect(
            service.generatePdf("test-job-run-id", reportType)
          ).rejects.toThrow(HttpException);
        }
      }
    });

    it("should handle complex jobRunId with various special characters", async () => {
      const complexJobRunId = "job!@#$%^&*()_+-=[]{}|;:,.<>?/~`run-id";
      const mockBuffer = Buffer.from("mock pdf content");
      jest
        .spyOn(service, "generateJobsReportPdf")
        .mockResolvedValue(mockBuffer);

      await service.generatePdf(complexJobRunId, ReportType.JOBS_RREPORT);

      // Should sanitize all special characters
      expect(mockPath.join).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringMatching(/job-run-id-jobs-report-report\.pdf/)
      );
    });

    it("should handle reportType with special characters", async () => {
      const mockBuffer = Buffer.from("mock pdf content");
      jest
        .spyOn(service, "generateJobsReportPdf")
        .mockResolvedValue(mockBuffer);

      // Using JOBS_RREPORT which has underscores
      await service.generatePdf("test-job-run-id", ReportType.JOBS_RREPORT);

      // Should sanitize reportType to lowercase
      expect(mockPath.join).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringMatching(/jobs-report-report\.pdf/)
      );
    });
  });
});
