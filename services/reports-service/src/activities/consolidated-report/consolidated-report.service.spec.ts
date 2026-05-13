import { Test, TestingModule } from "@nestjs/testing";
import { ConsolidatedReportService } from "./consolidated-report.service";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ReportsEntity } from "src/entities/reports.entity";
import { InventoryEntity } from "src/entities/inventory.entity";
import { FileServerEntity } from "src/entities/fileserver.entity";
import { Repository } from "typeorm";
import * as fs from "fs";
import { PDFDocument } from "pdf-lib";
import { LoggerFactory } from "@netapp-cloud-datamigrate/logger-lib";
import { PDFGeneratorService } from "src/generator/pdf-generator.service";

jest.mock("fs");
jest.mock("pdf-lib");

const mockPdfGeneratorService = {
  generatePDF: jest.fn().mockResolvedValue(Buffer.from("mock-pdf")),
};

describe("ConsolidatedReportService", () => {
  let service: ConsolidatedReportService;
  let inventoryRepo: jest.Mocked<Repository<InventoryEntity>>;
  let reportsRepo: jest.Mocked<Repository<ReportsEntity>>;
  let fileServerRepo: jest.Mocked<Repository<FileServerEntity>>;

  const mockLoggerFactory = {
    create: jest.fn().mockReturnValue({
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPdfGeneratorService.generatePDF.mockClear();
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.unlinkSync as jest.Mock).mockImplementation(() => {});
    (fs.mkdirSync as jest.Mock).mockImplementation(() => {});
    
    // Mock fs.promises methods
    const mockFsPromises = {
      readFile: jest.fn().mockResolvedValue(Buffer.from("mock-pdf")),
      writeFile: jest.fn().mockResolvedValue(undefined),
      mkdir: jest.fn().mockResolvedValue(undefined),
      unlink: jest.fn().mockResolvedValue(undefined),
      access: jest.fn().mockResolvedValue(undefined),
    };
    (fs as any).promises = mockFsPromises;
    
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConsolidatedReportService,
        {
          provide: PDFGeneratorService,
          useValue: mockPdfGeneratorService,
        },
        {
          provide: getRepositoryToken(InventoryEntity),
          useValue: {
            query: jest.fn(),
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(ReportsEntity),
          useValue: {
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(FileServerEntity),
          useValue: {
            update: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
      ],
    }).compile();

    service = module.get<ConsolidatedReportService>(ConsolidatedReportService);
    inventoryRepo = module.get(getRepositoryToken(InventoryEntity));
    reportsRepo = module.get(getRepositoryToken(ReportsEntity));
    fileServerRepo = module.get(getRepositoryToken(FileServerEntity));
  });

  describe("constructor", () => {
    it("should create service with LoggerFactory when provided", () => {
      expect(mockLoggerFactory.create).toHaveBeenCalledWith("ConsolidatedReportService");
      expect(service).toBeDefined();
    });

    it("should fallback to NestJS Logger when LoggerFactory not provided", async () => {
      const moduleNoLogger = await Test.createTestingModule({
        providers: [
          ConsolidatedReportService,
          { provide: PDFGeneratorService, useValue: mockPdfGeneratorService },
          { provide: getRepositoryToken(InventoryEntity), useValue: { query: jest.fn(), find: jest.fn() } },
          { provide: getRepositoryToken(ReportsEntity), useValue: { find: jest.fn() } },
          { provide: getRepositoryToken(FileServerEntity), useValue: { update: jest.fn(), findOne: jest.fn() } },
        ],
      }).compile();
      const svc = moduleNoLogger.get<ConsolidatedReportService>(ConsolidatedReportService);
      expect(svc).toBeDefined();
    });

    it("should use REPORT_DOWNLOAD_LOCATION when set", async () => {
      const orig = process.env.REPORT_DOWNLOAD_LOCATION;
      process.env.REPORT_DOWNLOAD_LOCATION = "/custom/reports";
      const moduleCustom = await Test.createTestingModule({
        providers: [
          ConsolidatedReportService,
          { provide: PDFGeneratorService, useValue: mockPdfGeneratorService },
          { provide: getRepositoryToken(InventoryEntity), useValue: { query: jest.fn(), find: jest.fn() } },
          { provide: getRepositoryToken(ReportsEntity), useValue: { find: jest.fn() } },
          { provide: getRepositoryToken(FileServerEntity), useValue: { update: jest.fn(), findOne: jest.fn() } },
          { provide: LoggerFactory, useValue: mockLoggerFactory },
        ],
      }).compile();
      const svc = moduleCustom.get<ConsolidatedReportService>(ConsolidatedReportService);
      const path = await svc.getConsolidatedReportPath({ fileServerId: "x", configName: "C" });
      expect(path).toContain("/custom/reports");
      process.env.REPORT_DOWNLOAD_LOCATION = orig;
    });

    it("should log error when initializeDirectories fails", async () => {
      const mockMkdir = jest.fn().mockRejectedValue(new Error("mkdir failed"));
      const mockFsPromises = {
        readFile: jest.fn().mockResolvedValue(Buffer.from("mock-pdf")),
        writeFile: jest.fn().mockResolvedValue(undefined),
        mkdir: mockMkdir,
        unlink: jest.fn().mockResolvedValue(undefined),
        access: jest.fn().mockResolvedValue(undefined),
      };
      (fs as any).promises = mockFsPromises;
      const mockLog = { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
      const mod = await Test.createTestingModule({
        providers: [
          ConsolidatedReportService,
          { provide: PDFGeneratorService, useValue: mockPdfGeneratorService },
          { provide: getRepositoryToken(InventoryEntity), useValue: { query: jest.fn(), find: jest.fn() } },
          { provide: getRepositoryToken(ReportsEntity), useValue: { find: jest.fn() } },
          { provide: getRepositoryToken(FileServerEntity), useValue: { update: jest.fn(), findOne: jest.fn() } },
          { provide: LoggerFactory, useValue: { create: () => mockLog } },
        ],
      }).compile();
      const svc = mod.get<ConsolidatedReportService>(ConsolidatedReportService);
      expect(svc).toBeDefined();
      await new Promise((r) => setImmediate(r));
      expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining("Failed to initialize directories"));
    });
  });

  describe("getDiscoveryJobsForFileServer", () => {
    it("should return discovery jobs for file server", async () => {
      const mockJobs = [
        { job_run_id: "job-1", volume_path: "/volume1", rn: "1" },
        { job_run_id: "job-2", volume_path: "/volume2", rn: "1" },
        { job_run_id: "job-3", volume_path: "/volume1", rn: "2" },
      ];

      inventoryRepo.query.mockResolvedValue(mockJobs);

      const result = await service.getDiscoveryJobsForFileServer({
        fileServerId: "test-file-server",
      });

      expect(result).toEqual([
        { jobRunId: "job-1", volumePath: "/volume1" },
        { jobRunId: "job-2", volumePath: "/volume2" },
      ]);
      expect(inventoryRepo.query).toHaveBeenCalled();
    });

    it("should return empty array when no jobs found", async () => {
      inventoryRepo.query.mockResolvedValue([]);

      const result = await service.getDiscoveryJobsForFileServer({
        fileServerId: "test-file-server",
      });

      expect(result).toEqual([]);
    });

    it("should filter to latest job per volume (rn === 1)", async () => {
      const mockJobs = [
        { job_run_id: "job-1", volume_path: "/vol1", rn: "1" },
        { job_run_id: "job-2", volume_path: "/vol1", rn: "2" },
      ];
      inventoryRepo.query.mockResolvedValue(mockJobs);

      const result = await service.getDiscoveryJobsForFileServer({ fileServerId: "fs1" });

      expect(result).toEqual([{ jobRunId: "job-1", volumePath: "/vol1" }]);
    });
  });

  describe("generateCsvForJobRun", () => {
    it("should return null when no report data found", async () => {
      reportsRepo.find.mockResolvedValue([]);

      const result = await service.generateCsvForJobRun({
        jobRunId: "test-job",
        volumePath: "/test/path",
      });

      expect(result).toBeNull();
    });

    it("should return null when report has no data", async () => {
      reportsRepo.find.mockResolvedValue([
        { jobRunId: "test-job", reportType: "DISCOVER", reportData: null } as any,
      ]);

      const result = await service.generateCsvForJobRun({
        jobRunId: "test-job",
        volumePath: "/test/path",
      });

      expect(result).toBeNull();
    });

    it("should generate CSV file path when report data exists", async () => {
      const mockReportData = [
        { category: "test", sub_category: "sc1", value: "v1", valueType: "string" },
      ];
      reportsRepo.find.mockResolvedValue([
        {
          jobRunId: "test-job",
          reportType: "DISCOVER",
          reportData: JSON.stringify(mockReportData),
          createdAt: new Date(),
        } as any,
      ]);

      const result = await service.generateCsvForJobRun({
        jobRunId: "test-job",
        volumePath: "/test/path",
      });

      expect(result).toBeTruthy();
      expect(result).toContain(".csv");
      expect(fs.promises.writeFile).toHaveBeenCalled();
    });

    it("should throw and log when CSV generation fails", async () => {
      reportsRepo.find.mockResolvedValue([
        {
          jobRunId: "test-job",
          reportType: "DISCOVER",
          reportData: "invalid-json",
          createdAt: new Date(),
        } as any,
      ]);

      await expect(
        service.generateCsvForJobRun({
          jobRunId: "test-job",
          volumePath: "/test/path",
        })
      ).rejects.toThrow();
    });

    it("should handle entry with header in entry and undefined value", async () => {
      const mockReportData = [
        { category: "c", sub_category: "sc1", value: "v1", valueType: "string", extraHeader: undefined as any },
      ];
      reportsRepo.find.mockResolvedValue([
        {
          jobRunId: "test-job",
          reportType: "DISCOVER",
          reportData: JSON.stringify(mockReportData),
          createdAt: new Date(),
        } as any,
      ]);
      const result = await service.generateCsvForJobRun({ jobRunId: "test-job", volumePath: "/path" });
      expect(result).toBeTruthy();
      expect(result).toContain(".csv");
    });

    it("should handle entry with value null (skip for dynamicHeaders)", async () => {
      const mockReportData = [
        { category: "c", sub_category: "sc1", value: null, valueType: "string" },
      ];
      reportsRepo.find.mockResolvedValue([
        {
          jobRunId: "test-job",
          reportType: "DISCOVER",
          reportData: JSON.stringify(mockReportData),
          createdAt: new Date(),
        } as any,
      ]);
      const result = await service.generateCsvForJobRun({ jobRunId: "test-job", volumePath: "/path" });
      expect(result).toBeTruthy();
    });
  });

  describe("mergeCsvFiles", () => {
    it("should merge multiple CSV files", async () => {
      const csv1 = "h1,h2\nv1,v2";
      const csv2 = "h1,h2,h3\nv1,v2,v3";
      (fs.promises.readFile as jest.Mock)
        .mockResolvedValueOnce(csv1)
        .mockResolvedValueOnce(csv2);
      (fs.promises.unlink as jest.Mock).mockResolvedValue(undefined);
      (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);

      const result = await service.mergeCsvFiles({
        csvFilePaths: ["/temp/1.csv", "/temp/2.csv"],
        outputPath: "/output/merged.csv",
      });

      expect(result).toBe("/output/merged.csv");
      expect(fs.promises.unlink).toHaveBeenCalledTimes(2);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        "/output/merged.csv",
        expect.any(String)
      );
    });

    it("should skip empty files and continue", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue("\n\n");
      (fs.promises.unlink as jest.Mock).mockResolvedValue(undefined);
      (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);

      const result = await service.mergeCsvFiles({
        csvFilePaths: ["/temp/empty.csv"],
        outputPath: "/output/merged.csv",
      });

      expect(result).toBe("/output/merged.csv");
    });

    it("should handle unlink failure with warning", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue("h1\nv1");
      (fs.promises.unlink as jest.Mock).mockRejectedValue(new Error("Unlink failed"));
      (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);

      const result = await service.mergeCsvFiles({
        csvFilePaths: ["/temp/1.csv"],
        outputPath: "/output/merged.csv",
      });

      expect(result).toBe("/output/merged.csv");
    });

    it("should parse quoted CSV with comma and escaped quote (parseCsvLine branches)", async () => {
      const csvContent = '"a,b","c""d"\n"v1","v2"';
      (fs.promises.readFile as jest.Mock).mockResolvedValue(csvContent);
      (fs.promises.unlink as jest.Mock).mockResolvedValue(undefined);
      (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);

      const result = await service.mergeCsvFiles({
        csvFilePaths: ["/temp/quoted.csv"],
        outputPath: "/output/merged.csv",
      });

      expect(result).toBe("/output/merged.csv");
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        "/output/merged.csv",
        expect.stringContaining("a,b")
      );
    });

    it("should merge CSVs with extra headers not in DISCOVERY_CSV_HEADER_ORDER", async () => {
      (fs.promises.readFile as jest.Mock)
        .mockResolvedValueOnce("h1,extra\nv1,v2")
        .mockResolvedValueOnce("h1\nv3");
      (fs.promises.unlink as jest.Mock).mockResolvedValue(undefined);
      (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);

      const result = await service.mergeCsvFiles({
        csvFilePaths: ["/temp/1.csv", "/temp/2.csv"],
        outputPath: "/output/merged.csv",
      });

      expect(result).toBe("/output/merged.csv");
    });
  });

  describe("generatePdfForJobRun", () => {
    it("should return null when no report data found", async () => {
      reportsRepo.find.mockResolvedValue([]);

      const result = await service.generatePdfForJobRun({
        jobRunId: "test-job",
        volumePath: "/test/path",
      });

      expect(result).toBeNull();
    });

    it("should return null when report has no data", async () => {
      reportsRepo.find.mockResolvedValue([
        { jobRunId: "test-job", reportType: "DISCOVER", reportData: null } as any,
      ]);

      const result = await service.generatePdfForJobRun({
        jobRunId: "test-job",
        volumePath: "/test/path",
      });

      expect(result).toBeNull();
    });

    it("should generate PDF file path when report data exists", async () => {
      // reportData should be an array for groupAndOrder to work
      const mockReportData = [
        { category: "test", data: "value" }
      ];
      reportsRepo.find.mockResolvedValue([
        {
          jobRunId: "test-job",
          reportType: "DISCOVER",
          reportData: JSON.stringify(mockReportData),
          createdAt: new Date(),
        } as any,
      ]);

      (fs.writeFileSync as jest.Mock).mockImplementation(() => {});

      const result = await service.generatePdfForJobRun({
        jobRunId: "test-job",
        volumePath: "/test/path",
      });

      expect(result).toBeTruthy();
      expect(result).toContain(".pdf");
      expect(fs.promises.writeFile).toHaveBeenCalled();
      expect(mockPdfGeneratorService.generatePDF).toHaveBeenCalled();
    });
  });

  describe("mergePdfFiles", () => {
    it("should merge multiple PDF files", async () => {
      const mockPdfDoc = {
        copyPages: jest.fn().mockResolvedValue([{}]),
        addPage: jest.fn(),
        save: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
        getPageCount: jest.fn().mockReturnValue(2),
        getPageIndices: jest.fn().mockReturnValue([0]),
      };

      (PDFDocument.create as jest.Mock).mockResolvedValue(mockPdfDoc);
      (PDFDocument.load as jest.Mock).mockResolvedValue(mockPdfDoc);
      (fs.readFileSync as jest.Mock).mockReturnValue(Buffer.from("pdf-content"));
      (fs.unlinkSync as jest.Mock).mockImplementation(() => {});
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {});

      const result = await service.mergePdfFiles({
        pdfFilePaths: ["/path/to/pdf1.pdf", "/path/to/pdf2.pdf"],
        outputPath: "/output/merged.pdf",
      });

      expect(PDFDocument.create).toHaveBeenCalled();
      expect(PDFDocument.load).toHaveBeenCalledTimes(2);
      expect(result).toBe("/output/merged.pdf");
      expect(fs.promises.writeFile).toHaveBeenCalled();
    });

    it("should throw error when PDF processing fails", async () => {
      (PDFDocument.create as jest.Mock).mockResolvedValue({
        copyPages: jest.fn(),
        addPage: jest.fn(),
      });
      (PDFDocument.load as jest.Mock).mockRejectedValue(
        new Error("Invalid PDF")
      );
      (fs.readFileSync as jest.Mock).mockReturnValue(Buffer.from("invalid"));

      await expect(
        service.mergePdfFiles({
          pdfFilePaths: ["/path/to/invalid.pdf"],
          outputPath: "/output/merged.pdf",
        })
      ).rejects.toThrow("Failed to process PDF 1: Invalid PDF");
    });
  });

  describe("getConsolidatedReportPath", () => {
    it("should generate report path with sanitized config name", async () => {
      const result = await service.getConsolidatedReportPath({
        fileServerId: "test-server",
        configName: "Test/Config:Name",
      });

      expect(result).toContain("Test_Config_Name");
      expect(result).toContain("consolidated-discovery-report");
      expect(result).toContain(".pdf");
    });

    it("should generate CSV path when format is csv", async () => {
      const result = await service.getConsolidatedReportPath({
        fileServerId: "test-server",
        configName: "MyConfig",
        format: "csv",
      });

      expect(result).toContain(".csv");
      expect(result).toContain("MyConfig");
      expect(result).toContain("consolidated-discovery-report");
    });

    it("should default to pdf when format is omitted", async () => {
      const result = await service.getConsolidatedReportPath({
        fileServerId: "test-server",
        configName: "MyConfig",
      });
      expect(result).toContain(".pdf");
    });
  });

  describe("cleanupTempFiles", () => {
    it("should remove temporary files", async () => {
      (fs.promises.access as jest.Mock).mockResolvedValue(undefined);
      (fs.promises.unlink as jest.Mock).mockResolvedValue(undefined);

      await service.cleanupTempFiles({
        filePaths: ["/temp/file1.pdf", "/temp/file2.pdf"],
      });

      expect(fs.promises.unlink).toHaveBeenCalledTimes(2);
    });

    it("should handle missing files gracefully", async () => {
      (fs.promises.access as jest.Mock).mockRejectedValue(new Error("File not found"));

      await service.cleanupTempFiles({
        filePaths: ["/nonexistent/file.pdf"],
      });

      expect(fs.promises.unlink).not.toHaveBeenCalled();
    });

    it("should log warning when unlink fails for a file", async () => {
      (fs.promises.access as jest.Mock).mockResolvedValue(undefined);
      (fs.promises.unlink as jest.Mock).mockRejectedValue(new Error("Unlink failed"));

      await service.cleanupTempFiles({
        filePaths: ["/temp/file.pdf"],
      });

      expect(fs.promises.unlink).toHaveBeenCalledWith("/temp/file.pdf");
    });
  });

  describe("updateConsolidatedReportStatus", () => {
    it("should update status for file server", async () => {
      fileServerRepo.update.mockResolvedValue({ affected: 1 } as any);

      await service.updateConsolidatedReportStatus({
        fileServerId: "test-server",
        status: "COMPLETED",
        reportPath: "/path/to/report.pdf",
      });

      expect(fileServerRepo.update).toHaveBeenCalledWith(
        { id: "test-server" },
        expect.objectContaining({
          consolidatedReportStatus: "COMPLETED",
          consolidatedReportPath: "/path/to/report.pdf",
        })
      );
    });

    it("should update with workflowId when provided", async () => {
      fileServerRepo.update.mockResolvedValue({ affected: 1 } as any);

      await service.updateConsolidatedReportStatus({
        fileServerId: "test-server",
        status: "IN_PROGRESS",
        workflowId: "wf-123",
      });

      expect(fileServerRepo.update).toHaveBeenCalledWith(
        { id: "test-server" },
        expect.objectContaining({
          consolidatedReportStatus: "IN_PROGRESS",
          consolidatedReportWorkflowId: "wf-123",
        })
      );
    });

    it("should pass undefined for optional reportPath and workflowId when not provided", async () => {
      fileServerRepo.update.mockResolvedValue({ affected: 1 } as any);

      await service.updateConsolidatedReportStatus({
        fileServerId: "test-server",
        status: "FAILED",
        errorMessage: "err",
      });

      const updateCall = fileServerRepo.update.mock.calls[0][1];
      expect(updateCall.consolidatedReportPath).toBeUndefined();
      expect(updateCall.consolidatedReportWorkflowId).toBeUndefined();
    });
  });

  describe("getConsolidatedReportStatus", () => {
    it("should return status when file server exists", async () => {
      const mockStatus = {
        consolidatedReportStatus: "COMPLETED",
        consolidatedReportPath: "/path/to/report.pdf",
        consolidatedReportWorkflowId: "workflow-123",
        consolidatedReportUpdatedAt: new Date(),
      };

      fileServerRepo.findOne.mockResolvedValue(mockStatus as any);

      const result = await service.getConsolidatedReportStatus("test-server");

      expect(result).toEqual({
        status: "COMPLETED",
        reportPath: "/path/to/report.pdf",
        workflowId: "workflow-123",
        updatedAt: mockStatus.consolidatedReportUpdatedAt,
      });
    });

    it("should return null when file server not found", async () => {
      fileServerRepo.findOne.mockResolvedValue(null);

      const result = await service.getConsolidatedReportStatus("unknown-server");

      expect(result).toBeNull();
    });
  });

  describe("initializeStatus", () => {
    it("should initialize status as IN_PROGRESS", async () => {
      fileServerRepo.update.mockResolvedValue({ affected: 1 } as any);

      await service.initializeStatus("test-server", "workflow-123", "TestConfig");

      expect(fileServerRepo.update).toHaveBeenCalledWith(
        { id: "test-server" },
        expect.objectContaining({
          consolidatedReportStatus: "IN_PROGRESS",
          consolidatedReportWorkflowId: "workflow-123",
        })
      );
    });
  });

  describe("getReportFilePath", () => {
    it("should return report path if file exists", async () => {
      const mockPath = "/path/to/report.pdf";
      fileServerRepo.findOne.mockResolvedValue({
        consolidatedReportPath: mockPath,
      } as any);
      (fs.promises.access as jest.Mock).mockResolvedValue(undefined);
      const result = await service.getReportFilePath("test-server");
      expect(result).toBe(mockPath);
    });

    it("should return null if file does not exist", async () => {
      fileServerRepo.findOne.mockResolvedValue({
        consolidatedReportPath: "/nonexistent/path.pdf",
      } as any);
      (fs.promises.access as jest.Mock).mockRejectedValue(new Error("File not found"));
      const result = await service.getReportFilePath("test-server");
      expect(result).toBeNull();
    });

    it("should return null if no status found", async () => {
      fileServerRepo.findOne.mockResolvedValue(null);

      const result = await service.getReportFilePath("unknown-server");

      expect(result).toBeNull();
    });

    it("should return null if consolidatedReportPath is empty", async () => {
      fileServerRepo.findOne.mockResolvedValue({ consolidatedReportPath: "" } as any);

      const result = await service.getReportFilePath("test-server");

      expect(result).toBeNull();
    });
  });

  describe("readReportFile", () => {
    it("should read report file from filesystem", async () => {
      const mockBuffer = Buffer.from("pdf-content");
      (fs.promises.readFile as jest.Mock).mockResolvedValue(mockBuffer);
      const result = await service.readReportFile("/path/to/report.pdf");
      expect(result).toEqual(mockBuffer);
      expect(fs.promises.readFile).toHaveBeenCalledWith("/path/to/report.pdf");
    });

    it("should throw when file read fails", async () => {
      (fs.promises.readFile as jest.Mock).mockRejectedValue(new Error("ENOENT"));

      await expect(service.readReportFile("/missing.pdf")).rejects.toThrow("ENOENT");
    });
  });

  describe("clearStatus", () => {
    it("should clear consolidated report status", async () => {
      fileServerRepo.update.mockResolvedValue({ affected: 1 } as any);

      await service.clearStatus("test-server");
      expect(fileServerRepo.update).toHaveBeenCalledWith(
        { id: "test-server" },
        expect.objectContaining({
          consolidatedReportStatus: null,
          consolidatedReportPath: null,
          consolidatedReportWorkflowId: null,
        })
      );
    });
  });
});