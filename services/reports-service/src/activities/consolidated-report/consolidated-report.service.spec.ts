import { Test, TestingModule } from "@nestjs/testing";
import { ConsolidatedReportService } from "./consolidated-report.service";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ReportsEntity } from "src/entities/reports.entity";
import { InventoryEntity } from "src/entities/inventory.entity";
import { FileServerEntity } from "src/entities/fileserver.entity";
import { Repository } from "typeorm";
import * as fs from "fs";
import { promises as fsPromises } from "fs";
import { PDFDocument } from "pdf-lib";
import { LoggerFactory } from "@netapp-cloud-datamigrate/logger-lib";
import * as hbs from "hbs";

jest.mock("fs");
jest.mock("hbs");
jest.mock("pdf-lib");
jest.mock("puppeteer", () => ({
  default: {
    launch: jest.fn().mockResolvedValue({
      newPage: jest.fn().mockResolvedValue({
        setContent: jest.fn(),
        setViewport: jest.fn(),
        pdf: jest.fn().mockResolvedValue(Buffer.from("mock-pdf")),
        close: jest.fn(),
      }),
      close: jest.fn(),
      version: jest.fn().mockResolvedValue("120.0"),
    }),
  },
}));

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
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.unlinkSync as jest.Mock).mockImplementation(() => {});
    (fs.mkdirSync as jest.Mock).mockImplementation(() => {});
    (hbs.compile as jest.Mock).mockReturnValue((data: any) => "<html>mocked</html>");
    
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
      (fs.readFileSync as jest.Mock).mockReturnValue("<html>template</html>");

      const result = await service.generatePdfForJobRun({
        jobRunId: "test-job",
        volumePath: "/test/path",
      });

      expect(result).toBeTruthy();
      expect(result).toContain(".pdf");
      expect(fs.promises.writeFile).toHaveBeenCalled();
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
  });

  describe("readReportFile", () => {
    it("should read report file from filesystem", async () => {
      const mockBuffer = Buffer.from("pdf-content");
      (fs.promises.readFile as jest.Mock).mockResolvedValue(mockBuffer);
      const result = await service.readReportFile("/path/to/report.pdf");
      expect(result).toEqual(mockBuffer);
      expect(fs.promises.readFile).toHaveBeenCalledWith("/path/to/report.pdf");
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

  describe("onModuleDestroy", () => {
    it("should close browser on module destroy", async () => {
      const mockCloseFn = jest.fn().mockResolvedValue(undefined);
      (service as any).browserInstance = {
        close: mockCloseFn,
      };
      await service.onModuleDestroy();
      expect(mockCloseFn).toHaveBeenCalled();
    });

    it("should handle browser close errors gracefully", async () => {
      const mockCloseFn = jest.fn().mockRejectedValue(new Error("Close failed"));
      (service as any).browserInstance = {
        close: mockCloseFn,
      };
      await expect(service.onModuleDestroy()).resolves.not.toThrow();
    });
  });
});