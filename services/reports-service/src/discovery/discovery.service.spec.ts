import { Test, TestingModule } from "@nestjs/testing";
import { DiscoveryService } from "./discovery.service";
import { getRepositoryToken } from "@nestjs/typeorm";
import { InventoryEntity } from "../entities/inventory.entity";
import { ReportsEntity } from "../entities/reports.entity";
import * as fs from "fs";
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import * as validation from "../utils/utils";
import * as puppeteer from "puppeteer";
import { LoggerFactory } from "@netapp-cloud-datamigrate/logger-lib";

jest.mock("puppeteer", () => {
  const mockPuppeteer = {
    launch: jest.fn().mockResolvedValue({
      newPage: jest.fn().mockResolvedValue({
        setContent: jest.fn().mockResolvedValue(null),
        pdf: jest.fn().mockResolvedValue(Buffer.from("mock pdf")),
      }),
      close: jest.fn().mockResolvedValue(null),
    }),
  };
  return {
    ...mockPuppeteer,
    default: mockPuppeteer,
  };
});

describe("DiscoveryService", () => {
  let service: DiscoveryService;
  let mockInventoryRepo;
  let mockReportsRepo;
  let loggerMock: any;

  const mockInventoryData = [
    {
      fileServerPathId: "server1",
      path: "/root/path1",
      parentPath: "/root",
      name: "path1",
    },
  ];

  const mockReportData = [
    {
      jobRunId: "job123",
      reportType: "discovery",
      reportData: JSON.stringify([
        {
          category: "Category1",
          sub_category: "SubCat1",
          count_or_space: "100",
          valueType: "count",
        },
      ]),
      createdAt: new Date(),
    },
  ];

  beforeEach(async () => {
    loggerMock = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    };
    mockInventoryRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      query: jest.fn(),
    };

    mockReportsRepo = {
      find: jest.fn(),
      save: jest.fn(),
    };

    const mockSanitizeHtml = jest.fn((str: string) => str);
    const mockEscapeHtml = jest.fn((str: string) => str);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscoveryService,
        {
          provide: getRepositoryToken(InventoryEntity),
          useValue: mockInventoryRepo,
        },
        {
          provide: getRepositoryToken(ReportsEntity),
          useValue: mockReportsRepo,
        },
        {
          provide: "SANITIZE_HTML",
          useValue: mockSanitizeHtml,
        },
        {
          provide: "ESCAPE_HTML",
          useValue: mockEscapeHtml,
        },
        {
          provide: LoggerFactory,
          useValue: {
            create: jest.fn().mockReturnValue(loggerMock),
          },
        },
      ],
    }).compile();

    service = module.get<DiscoveryService>(DiscoveryService);

    // Mock fs functions
    jest.spyOn(fs, "existsSync").mockImplementation(() => true);
    jest.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    jest.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("constructor", () => {
    it("should use fallback logger when LoggerFactory is not provided", async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DiscoveryService,
          {
            provide: getRepositoryToken(InventoryEntity),
            useValue: mockInventoryRepo,
          },
          {
            provide: getRepositoryToken(ReportsEntity),
            useValue: mockReportsRepo,
          },
          // Note: No LoggerFactory provided to test fallback
        ],
      }).compile();

      const serviceWithFallback = module.get<DiscoveryService>(DiscoveryService);
      expect(serviceWithFallback).toBeDefined();
    });
  });

  describe("createReportFile", () => {
    const jobRunId = "job123";
    const reportType = "DISCOVERY";

    beforeEach(() => {
      // Mock the procedure call
      jest
        .spyOn(validation, "validateFilePath")
        .mockImplementation((filePath: string) => true);

      mockInventoryRepo.query.mockImplementation((query, params) => {
        if (query.includes("generate_discovery_report")) {
          return Promise.resolve();
        }
        return Promise.reject(new Error("Unknown query"));
      });
    });

    it("should create report file successfully", async () => {
      const mockReportData = [
        {
          category: "Files",
          sub_category: "Total Files",
          valueType: "count",
          value: "100",
        },
      ];

      mockInventoryRepo.query.mockResolvedValue([]);

      mockReportsRepo.find.mockResolvedValue([
        {
          reportData: JSON.stringify(mockReportData),
          jobRunId,
          reportType,
          createdAt: new Date(),
        },
      ]);

      const mockPdfBuffer = Buffer.from("mock pdf content");
      jest
        .spyOn(service, "generatePdfFromData")
        .mockResolvedValue(mockPdfBuffer);

      const result = await service.createReportFile(jobRunId, reportType);

      expect(result).toEqual({ message: "Report generated successfully" });
      expect(fs.writeFileSync).toHaveBeenCalledTimes(2); // Once for CSV, once for PDF
    });

    it("should create directory if it does not exist", async () => {
      jest.spyOn(fs, "existsSync").mockReturnValueOnce(false);

      const mockReportData = [
        {
          category: "Test",
          sub_category: "Test",
          valueType: "count",
          value: "1",
        },
      ];

      mockInventoryRepo.query.mockResolvedValue([]);
      mockReportsRepo.find.mockResolvedValue([
        {
          reportData: JSON.stringify(mockReportData),
          jobRunId,
          reportType,
          createdAt: new Date(),
        },
      ]);

      const mockPdfBuffer = Buffer.from("mock pdf content");
      jest
        .spyOn(service, "generatePdfFromData")
        .mockResolvedValue(mockPdfBuffer);

      await service.createReportFile(jobRunId, reportType);

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ recursive: true })
      );
    });

    it("should throw error when procedure call fails", async () => {
      mockInventoryRepo.query.mockRejectedValue(new Error("Procedure failed"));

      await expect(
        service.createReportFile(jobRunId, reportType)
      ).rejects.toThrow(InternalServerErrorException);
    });

    it("should throw error when no report data found", async () => {
      mockInventoryRepo.query.mockResolvedValue([]);
      mockReportsRepo.find.mockResolvedValue([]);

      await expect(
        service.createReportFile(jobRunId, reportType)
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw error when file path contains invalid characters", async () => {
      // Mock validateFilePath to return false for this test
      jest.spyOn(validation, "validateFilePath").mockReturnValueOnce(false);

      const loggerSpy = jest.spyOn(service["logger"], "error");

      await expect(
        service.createReportFile(jobRunId, reportType)
      ).rejects.toThrow(
        "File path contains invalid characters."
      );

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining("File path contains invalid characters: reports/job123-discovery-report.pdf")
      );
    });

    it("should handle generic errors and throw InternalServerErrorException", async () => {
      process.env.SCHEMA = "test_schema";
      const genericError = new Error("Unexpected database error");
      mockInventoryRepo.query.mockRejectedValue(genericError);

      await expect(
        service.createReportFile(jobRunId, reportType)
      ).rejects.toThrow(
        new InternalServerErrorException(`Failed to generate report for jobRunId: ${jobRunId} and reportType: ${reportType}`)
      );
    });

    it("should re-throw known exceptions", async () => {
      process.env.SCHEMA = "test_schema";
      const badRequestError = new BadRequestException("Invalid request");
      mockInventoryRepo.query.mockRejectedValue(badRequestError);

      await expect(
        service.createReportFile(jobRunId, reportType)
      ).rejects.toThrow(badRequestError);
    });
  });

  describe("getReportsAsZip", () => {
    it("should create zip archive of reports", async () => {
      const jobRunIds = ["job123"];
      const reportType = "discovery";
      const mockZipBuffer = Buffer.from("mock zip content");

      jest
        .spyOn(fs, "existsSync")
        .mockReturnValueOnce(true) // Reports directory exists
        .mockReturnValueOnce(true); // File exists

      jest.spyOn(service, "createZipArchive").mockResolvedValue(mockZipBuffer);

      const result = await service.getReportsAsZip(jobRunIds, reportType);

      expect(result).toEqual(mockZipBuffer);
    });

    it("should throw error when no files found", async () => {
      const jobRunIds = ["job123"];
      const reportType = "discovery";

      jest
        .spyOn(fs, "existsSync")
        .mockReturnValueOnce(true) // Reports directory exists
        .mockReturnValueOnce(false); // File doesn't exist

      await expect(
        service.getReportsAsZip(jobRunIds, reportType)
      ).rejects.toThrow(NotFoundException);
    });

    it("should log warning when some files are not found but others exist", async () => {
      const jobRunIds = ["job123", "job456"];
      const reportType = "discovery";
      const mockZipBuffer = Buffer.from("mock zip content");

      // Mock console.warn to capture the warning
      const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();

      jest
        .spyOn(fs, "existsSync")
        .mockReturnValueOnce(true) // Reports directory exists
        .mockReturnValueOnce(true) // First file exists
        .mockReturnValueOnce(false); // Second file doesn't exist

      jest.spyOn(service, "createZipArchive").mockResolvedValue(mockZipBuffer);

      const result = await service.getReportsAsZip(jobRunIds, reportType);

      expect(result).toEqual(mockZipBuffer);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("File not found:")
      );

      consoleWarnSpy.mockRestore();
    });

    it("should throw error when reports directory does not exist", async () => {
      const jobRunIds = ["job123"];
      const reportType = "discovery";

      // Mock reports directory not existing
      jest.spyOn(fs, "existsSync").mockReturnValueOnce(false);

      // Use a more specific matcher to check both the error type and message in one assertion
      await expect(
        service.getReportsAsZip(jobRunIds, reportType)
      ).rejects.toThrowError("Reports directory does not exist: ./reports");
    });
  });

  describe("getDiscoveryByFileServerId", () => {
    it("should return discovery data", async () => {
      const fileServerId = "test-id";
      const mockInventory = {
        path: "/test/path",
        fileServerPathId: fileServerId,
      };

      mockInventoryRepo.findOne.mockResolvedValue(mockInventory);
      mockInventoryRepo.find.mockResolvedValue([
        { path: "/test/path/file1" },
        { path: "/test/path/file2" },
      ]);

      const result = await service.getDiscoveryByFileServerId(fileServerId);

      expect(result).toHaveLength(1);
      expect(result[0].root).toBe("path");
      expect(result[0].childs).toHaveLength(2);
    });

    it("should handle ServiceUnavailableException and re-throw it", async () => {
      const fileServerId = "test-id";
      const mockInventory = {
        path: "/test/path",
        fileServerPathId: fileServerId,
      };

      mockInventoryRepo.findOne.mockResolvedValue(mockInventory);

      const serviceUnavailableError = new ServiceUnavailableException("Service unavailable");
      jest.spyOn(service, 'getDataFromParentPath').mockRejectedValue(serviceUnavailableError);

      await expect(service.getDiscoveryByFileServerId(fileServerId)).rejects.toThrow(serviceUnavailableError);
    });

    it("should handle generic errors and throw InternalServerErrorException", async () => {
      const fileServerId = "test-id";
      const mockInventory = {
        path: "/test/path",
        fileServerPathId: fileServerId,
      };

      mockInventoryRepo.findOne.mockResolvedValue(mockInventory);

      const genericError = new Error("Database error");
      jest.spyOn(service, 'getDataFromParentPath').mockRejectedValue(genericError);

      await expect(service.getDiscoveryByFileServerId(fileServerId)).rejects.toThrow(
        new InternalServerErrorException('Failed to retrieve discovery data for the specified file server.')
      );
    });
  });

  describe("createJobsPDFReportData", () => {
    it("should call the stored procedure and return success message", async () => {
      const jobRunId = "job123";
      const loggerSpy = jest.spyOn(service["logger"], "log");

      mockInventoryRepo.query.mockResolvedValue([]);

      const result = await service.createJobsPDFReportData(jobRunId);

      expect(result).toEqual({
        message: "Report data generated successfully for jobs report",
      });
      expect(mockInventoryRepo.query).toHaveBeenCalledWith(
        expect.stringContaining("jobs_report_data_v2"),
        [jobRunId, process.env.SCHEMA]
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          `Creating jobs report data for jobRunId: ${jobRunId}`
        )
      );
    });

    it("should throw InternalServerErrorException when procedure call fails", async () => {
      const jobRunId = "job123";
      const loggerSpy = jest.spyOn(service["logger"], "log");

      mockInventoryRepo.query.mockRejectedValue(new Error("Procedure failed"));

      await expect(service.createJobsPDFReportData(jobRunId)).rejects.toThrow(
        InternalServerErrorException
      );

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          `Failed to generate report for jobRunId: ${jobRunId}`
        )
      );
    });
  });

  describe("getDiscoveryByFileServerIdAndParentPath", () => {
    it("should return discovery data with empty childs", async () => {
      mockInventoryRepo.find.mockResolvedValue(mockInventoryData);

      const result = await service.getDiscoveryByFileServerIdAndParentPath(
        "server1",
        "/root"
      );

      expect(result).toEqual(
        mockInventoryData.map((item) => ({ ...item, childs: [] }))
      );
    });

    it("should handle ServiceUnavailableException and re-throw it", async () => {
      const serviceUnavailableError = new ServiceUnavailableException("Service unavailable");
      jest.spyOn(service, 'getDataFromParentPath').mockRejectedValue(serviceUnavailableError);

      await expect(service.getDiscoveryByFileServerIdAndParentPath("server1", "/root")).rejects.toThrow(serviceUnavailableError);
    });

    it("should handle generic errors and throw InternalServerErrorException", async () => {
      const genericError = new Error("Database error");
      jest.spyOn(service, 'getDataFromParentPath').mockRejectedValue(genericError);

      await expect(service.getDiscoveryByFileServerIdAndParentPath("server1", "/root")).rejects.toThrow(
        new InternalServerErrorException('Failed to retrieve discovery data for the specified file server and path.')
      );
    });
  });

  describe("createZipArchive", () => {
    it("should create zip archive successfully", async () => {
      const mockFilePaths = ["path1", "path2"];
      const result = await service.createZipArchive(mockFilePaths);

      expect(result).toBeInstanceOf(Buffer);
    });
  });

  describe("formatAndWriteToFile", () => {
    it("should format and write data correctly", () => {
      const mockData = [
        {
          category: "Category1",
          sub_category: "SubCat1",
          count_or_space: "100",
        },
        {
          category: "Category1",
          sub_category: "SubCat2",
          count_or_space: "200",
          valueType: "count",
        },
      ];
      const mockFilePath = "test.txt";
      const writeFileSpy = jest.spyOn(fs, "writeFileSync").mockImplementation();
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      service.formatAndWriteToFile(mockData, mockFilePath);

      writeFileSpy.mockRestore();
      consoleSpy.mockRestore();
    });

    it("should throw error when file path contains invalid characters", () => {
      const mockData = [{ category: "Test", sub_category: "Test", value: 100 }];
      const mockFilePath = "invalid/path";

      // Mock validateFilePath to return false for this test
      jest.spyOn(validation, "validateFilePath").mockReturnValueOnce(false);

      const loggerSpy = jest.spyOn(service["logger"], "error");

      expect(() => {
        service.formatAndWriteToFile(mockData, mockFilePath);
      }).toThrow("File path contains invalid characters.");

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining("File path contains invalid characters:")
      );
    });

    it("should collect dynamic headers from report data", () => {
      const mockData = [
        {
          category: "Category1",
          sub_category: "SubCat1",
          value: "100",
          valueType: "count",
        },
        {
          category: "Category2",
          sub_category: "SubCat2",
          value: "200",
          valueType: "count",
        },
        {
          category: "Category3",
          sub_category: "SubCat3",
          value: null,
          valueType: "count",
        },
      ];
      const mockFilePath = "test.txt";

      // Mock groupAndOrder to return a specific structure
      jest
        .spyOn(require("../utils/group-order"), "groupAndOrder")
        .mockReturnValue({
          Category1: [{ sub_category: "SubCat1", value: "100" }],
          Category2: [{ sub_category: "SubCat2", value: "200" }],
          Category3: [{ sub_category: "SubCat3", value: null }],
        });

      const writeFileSpy = jest.spyOn(fs, "writeFileSync").mockImplementation();

      service.formatAndWriteToFile(mockData, mockFilePath);

      // Verify that writeFileSync was called with content that includes both headers
      expect(writeFileSpy).toHaveBeenCalledWith(
        mockFilePath,
        expect.stringContaining("SubCat1,SubCat2")
      );

      writeFileSpy.mockRestore();
    });

    it("should process entries with header matching sub_category", () => {
      const mockData = [
        {
          category: "Category1",
          sub_category: "SubCat1",
          value: "100",
          valueType: "count",
        },
      ];
      const mockFilePath = "test.txt";

      // Mock groupAndOrder to return a specific structure
      jest
        .spyOn(require("../utils/group-order"), "groupAndOrder")
        .mockReturnValue({
          Category1: [
            {
              category: "Category1",
              sub_category: "SubCat1",
              value: "100",
            },
          ],
        });

      const writeFileSpy = jest.spyOn(fs, "writeFileSync").mockImplementation();

      service.formatAndWriteToFile(mockData, mockFilePath);

      // Verify that writeFileSync was called with content that includes the value
      expect(writeFileSpy).toHaveBeenCalledWith(
        mockFilePath,
        expect.stringContaining("100")
      );

      writeFileSpy.mockRestore();
    });

    it("should handle both direct properties and sub_category matches", () => {
      const mockData = [
        {
          category: "Category1",
          sub_category: "SubCat1",
          value: "100",
          SubCat2: "200", // Direct property
          valueType: "count",
        },
      ];
      const mockFilePath = "test.txt";

      // Mock groupAndOrder to return a specific structure
      jest
        .spyOn(require("../utils/group-order"), "groupAndOrder")
        .mockReturnValue({
          Category1: [
            {
              category: "Category1",
              sub_category: "SubCat1",
              value: "100",
              SubCat2: "200",
            },
          ],
        });

      const writeFileSpy = jest.spyOn(fs, "writeFileSync").mockImplementation();

      service.formatAndWriteToFile(mockData, mockFilePath);

      // Verify that writeFileSync was called with content that includes both values
      expect(writeFileSpy).toHaveBeenCalledWith(
        mockFilePath,
        expect.stringContaining("100")
      );

      writeFileSpy.mockRestore();
    });

    it("should handle file write errors and throw InternalServerErrorException", () => {
      const mockData = [
        {
          category: "Category1",
          sub_category: "SubCat1",
          value: "100",
          valueType: "count",
        },
      ];
      const mockFilePath = "test.txt";

      // Mock validateFilePath to pass validation
      jest.spyOn(validation, "validateFilePath").mockReturnValue(true);

      // Mock fs.writeFileSync to throw an error
      const writeError = new Error("ENOSPC: no space left on device");
      jest.spyOn(fs, "writeFileSync").mockImplementation(() => {
        throw writeError;
      });

      expect(() => {
        service.formatAndWriteToFile(mockData, mockFilePath);
      }).toThrow(
        new InternalServerErrorException(`Failed to write report data to file: ${mockFilePath}`)
      );
    });

    it("should re-throw known exceptions from formatAndWriteToFile", () => {
      const mockData = [
        {
          category: "Category1",
          sub_category: "SubCat1",
          value: "100",
          valueType: "count",
        },
      ];
      const mockFilePath = "test.txt";

      // Mock validateFilePath to pass validation
      jest.spyOn(validation, "validateFilePath").mockReturnValue(true);

      const badRequestError = new BadRequestException("Invalid file format");
      jest.spyOn(fs, "writeFileSync").mockImplementation(() => {
        throw badRequestError;
      });

      expect(() => {
        service.formatAndWriteToFile(mockData, mockFilePath);
      }).toThrow(badRequestError);
    });
  });

  describe("getDataFromParentPath", () => {
    it("should return data for given fileServerId and parentPath", async () => {
      mockInventoryRepo.find.mockResolvedValue(mockInventoryData);

      const result = await service.getDataFromParentPath("server1", "/root");

      expect(result).toEqual(mockInventoryData);
      expect(mockInventoryRepo.find).toHaveBeenCalledWith({
        where: { fileServerPathId: "server1", parentPath: "/root" },
      });
    });

    it("should handle ServiceUnavailableException and re-throw it", async () => {
      const serviceUnavailableError = new ServiceUnavailableException("Database service unavailable");
      mockInventoryRepo.find.mockRejectedValue(serviceUnavailableError);

      await expect(service.getDataFromParentPath("server1", "/root")).rejects.toThrow(
        new ServiceUnavailableException('Unable to fetch data at this time. Please try again later.')
      );
    });

    it("should handle generic errors and throw ServiceUnavailableException", async () => {
      const genericError = new Error("Database connection failed");
      mockInventoryRepo.find.mockRejectedValue(genericError);

      await expect(service.getDataFromParentPath("server1", "/root")).rejects.toThrow(
        new ServiceUnavailableException('Unable to fetch data at this time. Please try again later.')
      );
    });
  });

  describe("getReportsDirectory", () => {
    it("should return custom directory from environment variable", () => {
      process.env.REPORT_DOWNLOAD_LOCATION = "/custom/path";
      expect(service.getReportsDirectory).toBe("/custom/path");
    });

    it("should return default directory when environment variable is not set", () => {
      delete process.env.REPORT_DOWNLOAD_LOCATION;
      expect(service.getReportsDirectory).toBe("./reports");
    });
  });

  describe("generatePdfFromData", () => {
    it("should sanitize and escape HTML in report data", async () => {
      const maliciousData = [
        {
          category: '<script>alert("xss")</script>',
          sub_category: "Total <b>Files</b>",
          value: "<img src=x onerror=alert(1)>",
        },
      ];

      const mockPdfBuffer = Buffer.from("mock pdf");
      const mockSetContent = jest.fn().mockResolvedValue(undefined);
      const mockPdf = jest.fn().mockResolvedValue(mockPdfBuffer);
      const mockNewPage = jest.fn().mockResolvedValue({
        setContent: mockSetContent,
        pdf: mockPdf,
      });
      const mockClose = jest.fn().mockResolvedValue(undefined);
      (puppeteer.launch as jest.Mock).mockResolvedValue({
        newPage: mockNewPage,
        close: mockClose,
      });

      await service.generatePdfFromData(maliciousData);

      const htmlArg = mockSetContent.mock.calls[0][0];
      expect(htmlArg).not.toContain("<script>");
      expect(htmlArg).not.toContain("<img");
    });
  });
});
