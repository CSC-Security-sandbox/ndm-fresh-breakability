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
} from "@nestjs/common";
import * as validation from "../utils/utils";
import * as puppeteer from "puppeteer";

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
      ],
    }).compile();

    service = module.get<DiscoveryService>(DiscoveryService);

    // Mock fs functions
    jest.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);
    jest.spyOn(fs.promises, "mkdir").mockResolvedValue(undefined);
    jest.spyOn(fs.promises, "writeFile").mockResolvedValue(undefined);
    jest.spyOn(fs.promises, "unlink").mockResolvedValue(undefined);
    jest.spyOn(fs, "createWriteStream").mockReturnValue({
      on: jest.fn((event: string, cb: any) => { if (event === "close") cb(); }),
    } as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
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
      expect(fs.writeFileSync).toHaveBeenCalledTimes(1); // CSV only (via formatAndWriteToFile); ZIP is streamed, PDF uses fs.promises.writeFile
      expect(fs.promises.writeFile).toHaveBeenCalledTimes(1); // PDF
      expect(fs.promises.unlink).toHaveBeenCalledTimes(1);    // raw CSV deleted after zipping
    });

    it("should create directory if it does not exist", async () => {
      jest.spyOn(fs.promises, "mkdir").mockResolvedValueOnce(undefined);

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

      expect(fs.promises.mkdir).toHaveBeenCalledWith(
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
      ).rejects.toThrow(InternalServerErrorException);
    });

    it("should throw error when file path contains invalid characters", async () => {
      // Mock validateFilePath to return false for this test
      jest.spyOn(validation, "validateFilePath").mockReturnValueOnce(false);

      const loggerSpy = jest.spyOn(service["logger"], "error");

      await expect(
        service.createReportFile(jobRunId, reportType)
      ).rejects.toThrow(
        "Failed to generate report for jobRunId: job123 and reportType: DISCOVERY"
      );

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining("File path contains invalid characters:")
      );
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
  });

  describe("createZipArchive", () => {
    it("should stream zip archive to the destination path", async () => {
      jest.spyOn(fs, "createWriteStream").mockReturnValue({
        on: jest.fn((event: string, cb: any) => { if (event === "close") cb(); }),
      } as any);

      await expect(
        service.createZipArchive(["path1", "path2"], "/tmp/out.zip")
      ).resolves.toBeUndefined();

      expect(fs.createWriteStream).toHaveBeenCalledWith("/tmp/out.zip");
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
          sub_category: "Config Name",
          value: "100",
          valueType: "count",
        },
        {
          category: "Category2",
          sub_category: "Path",
          value: "200",
          valueType: "count",
        },
        {
          category: "Category3",
          sub_category: "Status",
          value: null,
          valueType: "count",
        },
      ];
      const mockFilePath = "test.txt";

      // Mock groupAndOrder to return a specific structure (headers from ReportHeaders enum)
      jest
        .spyOn(require("../utils/group-order"), "groupAndOrder")
        .mockReturnValue({
          Category1: [{ sub_category: "Config Name", value: "100" }],
          Category2: [{ sub_category: "Path", value: "200" }],
          Category3: [{ sub_category: "Status", value: null }],
        });

      const writeFileSpy = jest.spyOn(fs, "writeFileSync").mockImplementation();

      service.formatAndWriteToFile(mockData, mockFilePath);

      // Verify that writeFileSync was called with content that includes both headers
      expect(writeFileSpy).toHaveBeenCalledWith(
        mockFilePath,
        expect.stringContaining("Config Name,Path")
      );

      writeFileSpy.mockRestore();
    });

    it("should process entries with header matching sub_category", () => {
      const mockData = [
        {
          category: "Category1",
          sub_category: "Config Name",
          value: "100",
          valueType: "count",
        },
      ];
      const mockFilePath = "test.txt";

      // Mock groupAndOrder to return a specific structure (sub_category from ReportHeaders)
      jest
        .spyOn(require("../utils/group-order"), "groupAndOrder")
        .mockReturnValue({
          Category1: [
            {
              category: "Category1",
              sub_category: "Config Name",
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
          sub_category: "Config Name",
          value: "100",
          Path: "200", // Direct property (ReportHeaders.PATH)
          valueType: "count",
        },
      ];
      const mockFilePath = "test.txt";

      // Mock groupAndOrder to return a specific structure (headers from ReportHeaders)
      jest
        .spyOn(require("../utils/group-order"), "groupAndOrder")
        .mockReturnValue({
          Category1: [
            {
              category: "Category1",
              sub_category: "Config Name",
              value: "100",
              Path: "200",
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
  });

  describe("getZipFilePath", () => {
    it("should return a valid zip file path", () => {
      const result = service.getZipFilePath(
        "550e8400-e29b-41d4-a716-446655440000",
        "discovery"
      );
      expect(result).toContain("550e8400-e29b-41d4-a716-446655440000");
      expect(result).toContain("discovery-report.zip");
    });

    it("should strip invalid characters from jobRunId and reportType", () => {
      const result = service.getZipFilePath("abc../123!!", "disc../overy!@#");
      expect(result).not.toContain("..");
      expect(result).not.toContain("!");
      expect(result).not.toContain("@");
    });
  });

  describe("prepareDownload", () => {
    it("should throw BadRequestException for invalid UUID", async () => {
      await expect(
        service.prepareDownload("not-a-valid-uuid", "discovery")
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw NotFoundException when zip file does not exist", async () => {
      jest
        .spyOn(service, "getZipFilePath")
        .mockReturnValue("./reports/550e8400-e29b-41d4-a716-446655440000-discovery-report.zip");
      jest
        .spyOn(fs.promises, "access")
        .mockRejectedValue(new Error("not found"));
      await expect(
        service.prepareDownload(
          "550e8400-e29b-41d4-a716-446655440000",
          "discovery"
        )
      ).rejects.toThrow(NotFoundException);
    });

    it("should return a token string when zip file exists", async () => {
      jest
        .spyOn(service, "getZipFilePath")
        .mockReturnValue("./reports/550e8400-e29b-41d4-a716-446655440000-discovery-report.zip");
      jest.spyOn(fs.promises, "access").mockResolvedValue(undefined);
      const token = await service.prepareDownload(
        "550e8400-e29b-41d4-a716-446655440000",
        "discovery"
      );
      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThan(0);
    });
  });

  describe("getAndConsumeDownloadToken", () => {
    it("should throw NotFoundException when token does not exist", async () => {
      await expect(
        service.getAndConsumeDownloadToken("nonexistent-token")
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when token is expired", async () => {
      (service as any).downloadTokens.set("expired-token", {
        filePath: "./reports/test.zip",
        fileName: "test.zip",
        expiresAt: Date.now() - 1000,
      });
      await expect(
        service.getAndConsumeDownloadToken("expired-token")
      ).rejects.toThrow(NotFoundException);
    });

    it("should return filePath and fileName for a valid non-expired token", async () => {
      (service as any).downloadTokens.set("valid-token", {
        filePath: "./reports/test.zip",
        fileName: "test.zip",
        expiresAt: Date.now() + 60000,
      });
      const result = await service.getAndConsumeDownloadToken("valid-token");
      expect(result.filePath).toBe("./reports/test.zip");
      expect(result.fileName).toBe("test.zip");
    });

    it("should delete the token after consuming it", async () => {
      (service as any).downloadTokens.set("one-time-token", {
        filePath: "./reports/test.zip",
        fileName: "test.zip",
        expiresAt: Date.now() + 60000,
      });
      await service.getAndConsumeDownloadToken("one-time-token");
      expect((service as any).downloadTokens.has("one-time-token")).toBe(false);
    });
  });

  describe("streamZipToResponse", () => {
    it("should stream zip file and set response headers", async () => {
      const mockStat = { size: 1024 };
      const mockStream = {
        on: jest.fn().mockReturnThis(),
        pipe: jest.fn(),
        destroyed: false,
        destroy: jest.fn(),
      };
      const mockRes: any = {
        set: jest.fn(),
        on: jest.fn(),
        headersSent: false,
        status: jest.fn().mockReturnThis(),
        end: jest.fn(),
      };

      jest.spyOn(fs.promises, "stat").mockResolvedValue(mockStat as any);
      jest.spyOn(fs, "createReadStream").mockReturnValue(mockStream as any);

      (service as any).downloadTokens.set("stream-token", {
        filePath: "./reports/test.zip",
        fileName: "test.zip",
        expiresAt: Date.now() + 60_000,
      });

      await service.streamZipToResponse("stream-token", mockRes);

      expect(mockRes.set).toHaveBeenCalledWith(
        expect.objectContaining({ "Content-Type": "application/zip" })
      );
      expect(mockStream.pipe).toHaveBeenCalledWith(mockRes);
    });

    it("should call res.status(500) on stream error when headers not sent", async () => {
      const mockStat = { size: 1024 };
      let errorHandler: (err: Error) => void;
      const mockStream = {
        on: jest.fn((event: string, cb: any) => {
          if (event === "error") errorHandler = cb;
          return mockStream;
        }),
        pipe: jest.fn(),
        destroyed: false,
        destroy: jest.fn(),
      };
      const mockRes: any = {
        set: jest.fn(),
        on: jest.fn(),
        headersSent: false,
        status: jest.fn().mockReturnThis(),
        end: jest.fn(),
      };

      jest.spyOn(fs.promises, "stat").mockResolvedValue(mockStat as any);
      jest.spyOn(fs, "createReadStream").mockReturnValue(mockStream as any);

      (service as any).downloadTokens.set("error-token", {
        filePath: "./reports/test.zip",
        fileName: "test.zip",
        expiresAt: Date.now() + 60000,
      });

      await service.streamZipToResponse("error-token", mockRes);
      errorHandler!(new Error("disk read error"));

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.end).toHaveBeenCalledWith("Failed to download file.");
    });

    it("should call res.end() on stream error when headers already sent", async () => {
      const mockStat = { size: 1024 };
      let errorHandler: (err: Error) => void;
      const mockStream = {
        on: jest.fn((event: string, cb: any) => {
          if (event === "error") errorHandler = cb;
          return mockStream;
        }),
        pipe: jest.fn(),
        destroyed: false,
        destroy: jest.fn(),
      };
      const mockRes: any = {
        set: jest.fn(),
        on: jest.fn(),
        headersSent: true,
        status: jest.fn().mockReturnThis(),
        end: jest.fn(),
      };

      jest.spyOn(fs.promises, "stat").mockResolvedValue(mockStat as any);
      jest.spyOn(fs, "createReadStream").mockReturnValue(mockStream as any);

      (service as any).downloadTokens.set("headers-sent-token", {
        filePath: "./reports/test.zip",
        fileName: "test.zip",
        expiresAt: Date.now() + 60000,
      });

      await service.streamZipToResponse("headers-sent-token", mockRes);
      errorHandler!(new Error("disk read error"));

      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockRes.end).toHaveBeenCalledWith();
    });

    it("should destroy stream when response closes", async () => {
      const mockStat = { size: 1024 };
      let closeHandler: () => void;
      const mockStream = {
        on: jest.fn().mockReturnThis(),
        pipe: jest.fn(),
        destroyed: false,
        destroy: jest.fn(),
      };
      const mockRes: any = {
        set: jest.fn(),
        on: jest.fn((event: string, cb: any) => {
          if (event === "close") closeHandler = cb;
        }),
        headersSent: false,
        status: jest.fn().mockReturnThis(),
        end: jest.fn(),
      };

      jest.spyOn(fs.promises, "stat").mockResolvedValue(mockStat as any);
      jest.spyOn(fs, "createReadStream").mockReturnValue(mockStream as any);

      (service as any).downloadTokens.set("close-token", {
        filePath: "./reports/test.zip",
        fileName: "test.zip",
        expiresAt: Date.now() + 60000,
      });

      await service.streamZipToResponse("close-token", mockRes);
      closeHandler!();

      expect(mockStream.destroy).toHaveBeenCalled();
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
