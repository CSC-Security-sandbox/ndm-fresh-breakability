// Mock TypeORM before any imports
jest.mock("typeorm", () => {
  const mockDecorator = jest.fn(
    () => (target: any, propertyKey?: string | symbol) => {
      return target;
    }
  );

  return {
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
  };
});

import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { InventoryEntity } from "../entities/inventory.entity";
import { ReportsEntity } from "../entities/reports.entity";
import {
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { ReportType } from "../constants/enums";
import * as fs from "fs";
import * as archiver from "archiver";
import puppeteer from "puppeteer";
import { groupAndOrder } from "../utils/group-order";
import {
  escapeCsvValue,
  escapeReportData,
  sanitizeReportData,
  validateFilePath,
} from "../utils/utils";

// Mock external dependencies
jest.mock("fs", () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(),
}));

jest.mock("puppeteer", () => ({
  launch: jest.fn(),
}));

jest.mock("archiver", () => jest.fn());

jest.mock("../utils/group-order", () => ({
  groupAndOrder: jest.fn(),
}));

jest.mock("../utils/utils", () => ({
  escapeCsvValue: jest.fn((value) => `"${value}"`),
  escapeReportData: jest.fn((data) => data),
  sanitizeReportData: jest.fn((data) => data),
  validateFilePath: jest.fn(),
}));

// Import the service after setting up mocks
import { DiscoveryService } from "./discovery.service";
import * as path from "path";

describe("DiscoveryService", () => {
  let service: DiscoveryService;
  let mockInventoryRepo: any;
  let mockReportsRepo: any;
  let mockLogger: any;

  beforeEach(async () => {
    mockInventoryRepo = {
      query: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
    };

    mockReportsRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
    };

    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    // Setup path spies
    jest.spyOn(path, "join").mockImplementation((...args) => args.join("/"));
    jest.spyOn(path, "basename").mockImplementation((filePath) => {
      return filePath.split("/").pop() || "";
    });

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
      ],
    }).compile();

    service = module.get<DiscoveryService>(DiscoveryService);
    // Mock the logger
    service["logger"] = mockLogger;
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe("getReportsDirectory", () => {
    it("should return environment variable when set", () => {
      process.env.REPORT_DOWNLOAD_LOCATION = "/custom/reports";

      const result = service.getReportsDirectory;

      expect(result).toBe("/custom/reports");
    });

    it("should return default directory when environment variable not set", () => {
      delete process.env.REPORT_DOWNLOAD_LOCATION;

      const result = service.getReportsDirectory;

      expect(result).toBe("./reports");
    });
  });

  describe("createReportFile", () => {
    beforeEach(() => {
      process.env.SCHEMA = "test_schema";
      process.env.REPORT_DOWNLOAD_LOCATION = "./reports";
      (validateFilePath as jest.Mock).mockReturnValue(true);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
    });

    it("should successfully create report file", async () => {
      const mockReportData = [
        { sub_category: "Files", value: "100" },
        { sub_category: "Directories", value: "10" },
      ];

      const mockReport = {
        reportData: JSON.stringify(mockReportData),
        createdAt: new Date(),
      };

      mockInventoryRepo.query.mockResolvedValue(undefined);
      mockReportsRepo.find.mockResolvedValue([mockReport]);

      const mockPdfBuffer = Buffer.from("pdf content");
      service.generatePdfFromData = jest.fn().mockResolvedValue(mockPdfBuffer);
      service.formatAndWriteToFile = jest.fn();

      const result = await service.createReportFile("job-123", "DISCOVERY");

      expect(result).toEqual({ message: "Report generated successfully" });
      expect(mockInventoryRepo.query).toHaveBeenCalledWith(
        `CALL test_schema.generate_discovery_report($1, $2)`,
        ["job-123", "test_schema"]
      );
      expect(mockReportsRepo.find).toHaveBeenCalledWith({
        where: { jobRunId: "job-123", reportType: "DISCOVERY" },
        order: { createdAt: "DESC" },
        take: 1,
      });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        "job-123-discovery-report.pdf",
        mockPdfBuffer
      );
    });

    it("should create reports directory if it doesn't exist", async () => {
      const mockReportData = [{ sub_category: "Files", value: "100" }];
      const mockReport = { reportData: JSON.stringify(mockReportData) };

      (fs.existsSync as jest.Mock)
        .mockReturnValueOnce(false)
        .mockReturnValue(true);
      mockInventoryRepo.query.mockResolvedValue(undefined);
      mockReportsRepo.find.mockResolvedValue([mockReport]);
      service.generatePdfFromData = jest
        .fn()
        .mockResolvedValue(Buffer.from("pdf"));
      service.formatAndWriteToFile = jest.fn();

      await service.createReportFile("job-123", "DISCOVERY");

      expect(fs.mkdirSync).toHaveBeenCalledWith("./reports", {
        recursive: true,
      });
    });

    it("should throw error when file path validation fails", async () => {
      (validateFilePath as jest.Mock).mockReturnValue(false);

      await expect(
        service.createReportFile("job-123", "DISCOVERY")
      ).rejects.toThrow(
        new InternalServerErrorException(
          "Failed to generate report for jobRunId: job-123 and reportType: DISCOVERY"
        )
      );
    });

    it("should throw error when no report data found", async () => {
      mockInventoryRepo.query.mockResolvedValue(undefined);
      mockReportsRepo.find.mockResolvedValue([]);

      await expect(
        service.createReportFile("job-123", "DISCOVERY")
      ).rejects.toThrow(
        new InternalServerErrorException(
          "Failed to generate report for jobRunId: job-123 and reportType: DISCOVERY"
        )
      );
    });

    it("should handle database procedure errors", async () => {
      mockInventoryRepo.query.mockRejectedValue(new Error("Database error"));

      await expect(
        service.createReportFile("job-123", "DISCOVERY")
      ).rejects.toThrow(
        new InternalServerErrorException(
          "Failed to generate report for jobRunId: job-123 and reportType: DISCOVERY"
        )
      );
    });

    it("should handle PDF generation errors", async () => {
      const mockReportData = [{ sub_category: "Files", value: "100" }];
      const mockReport = { reportData: JSON.stringify(mockReportData) };

      mockInventoryRepo.query.mockResolvedValue(undefined);
      mockReportsRepo.find.mockResolvedValue([mockReport]);
      service.generatePdfFromData = jest
        .fn()
        .mockRejectedValue(new Error("PDF error"));
      service.formatAndWriteToFile = jest.fn();

      await expect(
        service.createReportFile("job-123", "DISCOVERY")
      ).rejects.toThrow(
        new InternalServerErrorException(
          "Failed to generate report for jobRunId: job-123 and reportType: DISCOVERY"
        )
      );
    });

    it("should handle malformed JSON in report data", async () => {
      const mockReport = { reportData: "{ invalid json }" };

      mockInventoryRepo.query.mockResolvedValue(undefined);
      mockReportsRepo.find.mockResolvedValue([mockReport]);

      await expect(
        service.createReportFile("job-123", "DISCOVERY")
      ).rejects.toThrow(
        new InternalServerErrorException(
          "Failed to generate report for jobRunId: job-123 and reportType: DISCOVERY"
        )
      );
    });
  });

  describe("generateHtmlTable", () => {
    beforeEach(() => {
      (groupAndOrder as jest.Mock).mockReturnValue({
        "Category 1": [
          { sub_category: "Files", value: "100" },
          { sub_category: "Directories", value: "10" },
        ],
        "Category 2": [
          { sub_category: "Size", value: "1024MB" },
          { sub_category: "Empty", value: null },
        ],
      });
    });

    it("should generate HTML table with data", () => {
      const mockData = [
        { sub_category: "Files", value: "100" },
        { sub_category: "Directories", value: "10" },
      ];

      const result = service.generateHtmlTable(mockData);

      expect(result).toContain("<html>");
      expect(result).toContain("<h1>Data Summary</h1>");
      expect(result).toContain("<h2>Category 1</h2>");
      expect(result).toContain("<h2>Category 2</h2>");
      expect(result).toContain("<td>Files</td>");
      expect(result).toContain("<td>100</td>");
      expect(result).toContain("<td>Directories</td>");
      expect(result).toContain("<td>10</td>");
      expect(result).toContain("<td>Size</td>");
      expect(result).toContain("<td>1024MB</td>");
      expect(result).not.toContain("<td>Empty</td>");
    });

    it("should handle empty data", () => {
      (groupAndOrder as jest.Mock).mockReturnValue({});

      const result = service.generateHtmlTable([]);

      expect(result).toContain("<html>");
      expect(result).toContain("<h1>Data Summary</h1>");
      expect(result).toContain("</html>");
    });

    it("should skip entries with null values", () => {
      (groupAndOrder as jest.Mock).mockReturnValue({
        "Category 1": [
          { sub_category: "Files", value: "100" },
          { sub_category: "Empty", value: null },
          { sub_category: "Undefined", value: undefined },
        ],
      });

      const result = service.generateHtmlTable([]);

      expect(result).toContain("<td>Files</td>");
      expect(result).not.toContain("<td>Empty</td>");
      expect(result).not.toContain("<td>Undefined</td>");
    });
  });

  describe("generatePdfFromData", () => {
    let mockBrowser: any;
    let mockPage: any;

    beforeEach(() => {
      mockPage = {
        setContent: jest.fn(),
        pdf: jest.fn(),
      };

      mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      };

      (puppeteer.launch as jest.Mock).mockResolvedValue(mockBrowser);
      (sanitizeReportData as jest.Mock).mockImplementation((data) => data);
      (escapeReportData as jest.Mock).mockImplementation((data) => data);
    });

    it("should generate PDF from data", async () => {
      const mockData = [{ sub_category: "Files", value: "100" }];
      const mockPdfBuffer = Buffer.from("pdf content");

      mockPage.pdf.mockResolvedValue(mockPdfBuffer);
      service.generateHtmlTable = jest
        .fn()
        .mockReturnValue("<html>Test</html>");

      const result = await service.generatePdfFromData(mockData);

      expect(result).toEqual(mockPdfBuffer);
      expect(puppeteer.launch).toHaveBeenCalledWith({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
        ],
        executablePath: "/usr/bin/chromium-browser",
        protocolTimeout: 60000,
      });
      expect(mockPage.setContent).toHaveBeenCalledWith("<html>Test</html>", {
        waitUntil: "networkidle0",
      });
      expect(mockPage.pdf).toHaveBeenCalledWith({
        format: "A4",
        printBackground: true,
      });
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it("should sanitize and escape data before processing", async () => {
      const mockData = [
        { sub_category: "Files", value: "<script>alert('xss')</script>" },
      ];
      const sanitizedData = [{ sub_category: "Files", value: "alert('xss')" }];
      const escapedData = [
        {
          sub_category: "Files",
          value: "&lt;script&gt;alert('xss')&lt;/script&gt;",
        },
      ];

      (sanitizeReportData as jest.Mock).mockReturnValue(sanitizedData);
      (escapeReportData as jest.Mock).mockReturnValue(escapedData);

      mockPage.pdf.mockResolvedValue(Buffer.from("pdf"));
      service.generateHtmlTable = jest
        .fn()
        .mockReturnValue("<html>Test</html>");

      await service.generatePdfFromData(mockData);

      expect(sanitizeReportData).toHaveBeenCalledWith(mockData);
      expect(escapeReportData).toHaveBeenCalledWith(sanitizedData);
      expect(service.generateHtmlTable).toHaveBeenCalledWith(escapedData);
    });

    it("should handle puppeteer launch errors", async () => {
      (puppeteer.launch as jest.Mock).mockRejectedValue(
        new Error("Puppeteer error")
      );

      await expect(service.generatePdfFromData([])).rejects.toThrow(
        "Puppeteer error"
      );
    });

    it("should handle PDF generation errors", async () => {
      mockPage.pdf.mockRejectedValue(new Error("PDF generation error"));
      service.generateHtmlTable = jest
        .fn()
        .mockReturnValue("<html>Test</html>");

      await expect(service.generatePdfFromData([])).rejects.toThrow(
        "PDF generation error"
      );
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it("should handle page content setting errors", async () => {
      mockPage.setContent.mockRejectedValue(new Error("Content error"));
      service.generateHtmlTable = jest
        .fn()
        .mockReturnValue("<html>Test</html>");

      await expect(service.generatePdfFromData([])).rejects.toThrow(
        "Content error"
      );
      expect(mockBrowser.close).toHaveBeenCalled();
    });
  });

  describe("createJobsPDFReportData", () => {
    beforeEach(() => {
      process.env.SCHEMA = "test_schema";
    });

    it("should successfully create jobs PDF report data", async () => {
      mockInventoryRepo.query.mockResolvedValue(undefined);

      const result = await service.createJobsPDFReportData("job-123");

      expect(result).toEqual({
        message: "Report data generated successfully for jobs report",
      });
      expect(mockInventoryRepo.query).toHaveBeenCalledWith(
        `CALL test_schema.jobs_report_data_v2($1::UUID, $2);`,
        ["job-123", "test_schema"]
      );
    });

    it("should handle database procedure errors", async () => {
      mockInventoryRepo.query.mockRejectedValue(new Error("Database error"));

      await expect(service.createJobsPDFReportData("job-123")).rejects.toThrow(
        new InternalServerErrorException(
          "Failed to generate report for jobRunId: job-123"
        )
      );
    });

    it("should handle invalid UUID format", async () => {
      mockInventoryRepo.query.mockRejectedValue(
        new Error("Invalid UUID format")
      );

      await expect(
        service.createJobsPDFReportData("invalid-uuid")
      ).rejects.toThrow(
        new InternalServerErrorException(
          "Failed to generate report for jobRunId: invalid-uuid"
        )
      );
    });
  });

  describe("formatAndWriteToFile", () => {
    beforeEach(() => {
      (validateFilePath as jest.Mock).mockReturnValue(true);
      (groupAndOrder as jest.Mock).mockReturnValue({
        "Category 1": [
          { sub_category: "Files", value: "100" },
          { sub_category: "Directories", value: "10" },
        ],
      });
      (escapeCsvValue as jest.Mock).mockImplementation((value) => `"${value}"`);
    });

    it("should format and write CSV file", () => {
      const mockData = [
        { sub_category: "Files", value: "100" },
        { sub_category: "Directories", value: "10" },
      ];

      service.formatAndWriteToFile(mockData, "/path/to/test.csv");

      expect(validateFilePath).toHaveBeenCalledWith("/path/to/test.csv");
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        "/path/to/test.csv",
        expect.stringContaining("Files,Directories")
      );
    });

    it("should throw error when file path validation fails", () => {
      (validateFilePath as jest.Mock).mockReturnValue(false);

      expect(() => {
        service.formatAndWriteToFile([], "/invalid/path");
      }).toThrow("File path contains invalid characters.");
    });

    it("should handle empty data", () => {
      (groupAndOrder as jest.Mock).mockReturnValue({});

      service.formatAndWriteToFile([], "/path/to/test.csv");

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        "/path/to/test.csv",
        expect.stringContaining("")
      );
    });

    it("should handle null values in data", () => {
      (groupAndOrder as jest.Mock).mockReturnValue({
        "Category 1": [
          { sub_category: "Files", value: "100" },
          { sub_category: "Empty", value: null },
          { sub_category: "Undefined", value: undefined },
        ],
      });

      service.formatAndWriteToFile([], "/path/to/test.csv");

      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it("should handle special characters in values", () => {
      (groupAndOrder as jest.Mock).mockReturnValue({
        "Category 1": [
          { sub_category: "Files", value: "100,200" },
          { sub_category: "Paths", value: "/path/with spaces" },
        ],
      });

      service.formatAndWriteToFile([], "/path/to/test.csv");

      expect(escapeCsvValue).toHaveBeenCalledWith("100,200");
      expect(escapeCsvValue).toHaveBeenCalledWith("/path/with spaces");
    });
  });

  describe("getReportsAsZip", () => {
    let mockArchive: any;

    beforeEach(() => {
      mockArchive = {
        file: jest.fn(),
        on: jest.fn(),
        finalize: jest.fn(),
      };

      (archiver as jest.Mock).mockReturnValue(mockArchive);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
    });

    it("should create zip archive with existing reports", async () => {
      const jobRunIds = ["job-123", "job-456"];
      const reportType = "DISCOVERY";

      // Mock successful file existence
      (fs.existsSync as jest.Mock)
        .mockReturnValueOnce(true) // reports directory exists
        .mockReturnValueOnce(true) // job-123 file exists
        .mockReturnValueOnce(true); // job-456 file exists

      // Mock archive events
      mockArchive.on.mockImplementation((event, callback) => {
        if (event === "end") {
          setTimeout(() => callback(), 0);
        }
        return mockArchive;
      });

      service.createZipArchive = jest
        .fn()
        .mockResolvedValue(Buffer.from("zip content"));

      const result = await service.getReportsAsZip(jobRunIds, reportType);

      expect(result).toEqual(Buffer.from("zip content"));
      expect(service.createZipArchive).toHaveBeenCalledWith([
        "job-123-discovery-report.csv",
        "job-456-discovery-report.csv",
      ]);
    });

    it("should throw NotFoundException when reports directory doesn't exist", async () => {
      (fs.existsSync as jest.Mock).mockReturnValueOnce(false);

      await expect(
        service.getReportsAsZip(["job-123"], "DISCOVERY")
      ).rejects.toThrow(
        new NotFoundException("Reports directory does not exist: ./reports")
      );
    });

    it("should throw NotFoundException when no valid files found", async () => {
      (fs.existsSync as jest.Mock)
        .mockReturnValueOnce(true) // reports directory exists
        .mockReturnValueOnce(false); // no files exist

      await expect(
        service.getReportsAsZip(["job-123"], "DISCOVERY")
      ).rejects.toThrow(
        new NotFoundException(
          "No valid report files found for the given inputs."
        )
      );
    });

    it("should handle partial file existence", async () => {
      const jobRunIds = ["job-123", "job-456", "job-789"];

      (fs.existsSync as jest.Mock)
        .mockReturnValueOnce(true) // reports directory exists
        .mockReturnValueOnce(true) // job-123 file exists
        .mockReturnValueOnce(false) // job-456 file doesn't exist
        .mockReturnValueOnce(true); // job-789 file exists

      service.createZipArchive = jest
        .fn()
        .mockResolvedValue(Buffer.from("zip content"));

      const result = await service.getReportsAsZip(jobRunIds, "DISCOVERY");

      expect(result).toEqual(Buffer.from("zip content"));
      expect(service.createZipArchive).toHaveBeenCalledWith([
        "job-123-discovery-report.csv",
        "job-789-discovery-report.csv",
      ]);
    });
  });

  describe("createZipArchive", () => {
    let mockArchive: any;

    beforeEach(() => {
      mockArchive = {
        file: jest.fn(),
        on: jest.fn(),
        finalize: jest.fn(),
      };

      (archiver as jest.Mock).mockReturnValue(mockArchive);
    });

    it("should create zip archive successfully", async () => {
      const filePaths = ["/path/to/file1.csv", "/path/to/file2.csv"];
      const mockBuffer = Buffer.from("zip content");

      mockArchive.on.mockImplementation((event, callback) => {
        if (event === "data") {
          setTimeout(() => callback(mockBuffer), 0);
        } else if (event === "end") {
          setTimeout(() => callback(), 10);
        }
        return mockArchive;
      });

      const result = await service.createZipArchive(filePaths);

      expect(result).toEqual(mockBuffer);
      expect(mockArchive.file).toHaveBeenCalledWith("/path/to/file1.csv", {
        name: "file1.csv",
      });
      expect(mockArchive.file).toHaveBeenCalledWith("/path/to/file2.csv", {
        name: "file2.csv",
      });
      expect(mockArchive.finalize).toHaveBeenCalled();
    });

    it("should handle archiver errors", async () => {
      const filePaths = ["/path/to/file1.csv"];
      const error = new Error("Archiver error");

      mockArchive.on.mockImplementation((event, callback) => {
        if (event === "error") {
          setTimeout(() => callback(error), 0);
        }
        return mockArchive;
      });

      await expect(service.createZipArchive(filePaths)).rejects.toThrow(
        "Archiver error"
      );
    });

    it("should handle empty file paths", async () => {
      mockArchive.on.mockImplementation((event, callback) => {
        if (event === "end") {
          setTimeout(() => callback(), 0);
        }
        return mockArchive;
      });

      const result = await service.createZipArchive([]);

      expect(result).toEqual(Buffer.concat([]));
      expect(mockArchive.file).not.toHaveBeenCalled();
      expect(mockArchive.finalize).toHaveBeenCalled();
    });
  });

  describe("getDiscoveryByFileServerId", () => {
    it("should get discovery data by file server ID", async () => {
      const mockRecord = {
        fileServerPathId: "server-123",
        path: "/root/path/folder",
        parentPath: "/root/path",
      };

      const mockData = [
        { id: "1", name: "file1.txt", isDirectory: false },
        { id: "2", name: "folder1", isDirectory: true },
      ];

      mockInventoryRepo.findOne.mockResolvedValue(mockRecord);
      service.getDataFromParentPath = jest.fn().mockResolvedValue(mockData);

      const result = await service.getDiscoveryByFileServerId("server-123");

      expect(result).toEqual([
        {
          root: "folder",
          childs: [
            { id: "1", name: "file1.txt", isDirectory: false, childs: [] },
            { id: "2", name: "folder1", isDirectory: true, childs: [] },
          ],
        },
      ]);
      expect(service.getDataFromParentPath).toHaveBeenCalledWith(
        "server-123",
        "/root/path/folder"
      );
    });

    it("should handle empty data", async () => {
      const mockRecord = {
        fileServerPathId: "server-123",
        path: "/root/path/folder",
        parentPath: "/root/path",
      };

      mockInventoryRepo.findOne.mockResolvedValue(mockRecord);
      service.getDataFromParentPath = jest.fn().mockResolvedValue([]);

      const result = await service.getDiscoveryByFileServerId("server-123");

      expect(result).toEqual([
        {
          root: "folder",
          childs: [],
        },
      ]);
    });

    it("should handle single file path", async () => {
      const mockRecord = {
        fileServerPathId: "server-123",
        path: "/root/file.txt",
        parentPath: "/root",
      };

      mockInventoryRepo.findOne.mockResolvedValue(mockRecord);
      service.getDataFromParentPath = jest.fn().mockResolvedValue([]);

      const result = await service.getDiscoveryByFileServerId("server-123");

      expect(result).toEqual([
        {
          root: "file.txt",
          childs: [],
        },
      ]);
    });
  });

  describe("getDiscoveryByFileServerIdAndParentPath", () => {
    it("should get discovery data by file server ID and parent path", async () => {
      const mockData = [
        { id: "1", name: "file1.txt", isDirectory: false },
        { id: "2", name: "folder1", isDirectory: true },
      ];

      service.getDataFromParentPath = jest.fn().mockResolvedValue(mockData);

      const result = await service.getDiscoveryByFileServerIdAndParentPath(
        "server-123",
        "/root/path"
      );

      expect(result).toEqual([
        { id: "1", name: "file1.txt", isDirectory: false, childs: [] },
        { id: "2", name: "folder1", isDirectory: true, childs: [] },
      ]);
      expect(service.getDataFromParentPath).toHaveBeenCalledWith(
        "server-123",
        "/root/path"
      );
    });

    it("should handle empty results", async () => {
      service.getDataFromParentPath = jest.fn().mockResolvedValue([]);

      const result = await service.getDiscoveryByFileServerIdAndParentPath(
        "server-123",
        "/root/path"
      );

      expect(result).toEqual([]);
    });
  });

  describe("getDataFromParentPath", () => {
    it("should get data from parent path", async () => {
      const mockData = [
        { id: "1", name: "file1.txt", fileServerPathId: "server-123" },
        { id: "2", name: "folder1", fileServerPathId: "server-123" },
      ];

      mockInventoryRepo.find.mockResolvedValue(mockData);

      const result = await service.getDataFromParentPath(
        "server-123",
        "/root/path"
      );

      expect(result).toEqual(mockData);
      expect(mockInventoryRepo.find).toHaveBeenCalledWith({
        where: { fileServerPathId: "server-123", parentPath: "/root/path" },
      });
    });

    it("should handle empty results", async () => {
      mockInventoryRepo.find.mockResolvedValue([]);

      const result = await service.getDataFromParentPath(
        "server-123",
        "/root/path"
      );

      expect(result).toEqual([]);
    });

    it("should handle repository errors", async () => {
      mockInventoryRepo.find.mockRejectedValue(new Error("Database error"));

      await expect(
        service.getDataFromParentPath("server-123", "/root/path")
      ).rejects.toThrow("Database error");
    });
  });

  describe("Service Initialization", () => {
    it("should be defined", () => {
      expect(service).toBeDefined();
    });

    it("should have all required methods", () => {
      expect(typeof service.createReportFile).toBe("function");
      expect(typeof service.generateHtmlTable).toBe("function");
      expect(typeof service.generatePdfFromData).toBe("function");
      expect(typeof service.createJobsPDFReportData).toBe("function");
      expect(typeof service.formatAndWriteToFile).toBe("function");
      expect(typeof service.getReportsAsZip).toBe("function");
      expect(typeof service.createZipArchive).toBe("function");
      expect(typeof service.getDiscoveryByFileServerId).toBe("function");
      expect(typeof service.getDiscoveryByFileServerIdAndParentPath).toBe(
        "function"
      );
      expect(typeof service.getDataFromParentPath).toBe("function");
    });

    it("should have correct repository dependencies", () => {
      expect(service["inventoryRepo"]).toBeDefined();
      expect(service["reportsRepo"]).toBeDefined();
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle concurrent requests", async () => {
      const promises = Array.from({ length: 3 }, (_, i) =>
        service.getDiscoveryByFileServerId(`server-${i}`)
      );

      mockInventoryRepo.findOne.mockResolvedValue({
        fileServerPathId: "server-123",
        path: "/root/path",
      });
      service.getDataFromParentPath = jest.fn().mockResolvedValue([]);

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result).toHaveProperty("0.root");
        expect(result).toHaveProperty("0.childs");
      });
    });

    it("should handle large datasets", async () => {
      const largeData = Array.from({ length: 1000 }, (_, i) => ({
        id: `${i}`,
        name: `file${i}.txt`,
        isDirectory: false,
      }));

      service.getDataFromParentPath = jest.fn().mockResolvedValue(largeData);

      const result = await service.getDiscoveryByFileServerIdAndParentPath(
        "server-123",
        "/root/path"
      );

      expect(result).toHaveLength(1000);
      expect(result[0]).toHaveProperty("childs", []);
    });

    it("should handle special characters in paths", async () => {
      const mockRecord = {
        fileServerPathId: "server-123",
        path: "/root/path with spaces/special@chars#folder",
        parentPath: "/root/path with spaces",
      };

      mockInventoryRepo.findOne.mockResolvedValue(mockRecord);
      service.getDataFromParentPath = jest.fn().mockResolvedValue([]);

      const result = await service.getDiscoveryByFileServerId("server-123");

      expect(result[0].root).toBe("special@chars#folder");
    });

    it("should handle null/undefined findOne result", async () => {
      mockInventoryRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getDiscoveryByFileServerId("server-123")
      ).rejects.toThrow();
    });

    it("should handle repository errors in getDiscoveryByFileServerId", async () => {
      mockInventoryRepo.findOne.mockRejectedValue(new Error("Database error"));

      await expect(
        service.getDiscoveryByFileServerId("server-123")
      ).rejects.toThrow("Database error");
    });
  });

  describe("Additional Coverage Tests", () => {
    it("should handle custom report download location in environment", () => {
      process.env.REPORT_DOWNLOAD_LOCATION = "/custom/path/reports";

      const result = service.getReportsDirectory;

      expect(result).toBe("/custom/path/reports");
    });

    it("should handle createReportFile with custom environment variables", async () => {
      process.env.SCHEMA = "custom_schema";
      process.env.REPORT_DOWNLOAD_LOCATION = "/custom/reports";

      const mockReportData = [{ sub_category: "Files", value: "50" }];
      const mockReport = { reportData: JSON.stringify(mockReportData) };

      (validateFilePath as jest.Mock).mockReturnValue(true);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      mockInventoryRepo.query.mockResolvedValue(undefined);
      mockReportsRepo.find.mockResolvedValue([mockReport]);
      service.generatePdfFromData = jest
        .fn()
        .mockResolvedValue(Buffer.from("pdf"));
      service.formatAndWriteToFile = jest.fn();

      await service.createReportFile("job-456", "CUSTOM");

      expect(mockInventoryRepo.query).toHaveBeenCalledWith(
        `CALL custom_schema.generate_discovery_report($1, $2)`,
        ["job-456", "custom_schema"]
      );
    });

    it("should handle formatAndWriteToFile with complex data structure", () => {
      const complexData = [
        { sub_category: "Files", value: "100", extra_field: "ignored" },
        { sub_category: "Directories", value: "10", nested: { data: "test" } },
      ];

      (validateFilePath as jest.Mock).mockReturnValue(true);
      (groupAndOrder as jest.Mock).mockReturnValue({
        "Category 1": complexData,
      });
      (escapeCsvValue as jest.Mock).mockImplementation((value) => `"${value}"`);

      service.formatAndWriteToFile(complexData, "/path/to/complex.csv");

      expect(groupAndOrder).toHaveBeenCalledWith(
        complexData,
        ReportType.DISCOVERY
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        "/path/to/complex.csv",
        expect.stringContaining("Files,Directories")
      );
    });

    it("should handle generateHtmlTable with complex nested data", () => {
      const complexCategories = {
        "File System": [
          { sub_category: "Total Files", value: "1000" },
          { sub_category: "Large Files", value: "50" },
        ],
        "Directory Structure": [
          { sub_category: "Total Directories", value: "100" },
          { sub_category: "Empty Directories", value: "5" },
        ],
        Permissions: [
          { sub_category: "Read Only", value: "200" },
          { sub_category: "Write Protected", value: "10" },
        ],
      };

      (groupAndOrder as jest.Mock).mockReturnValue(complexCategories);

      const result = service.generateHtmlTable([]);

      expect(result).toContain("<h2>File System</h2>");
      expect(result).toContain("<h2>Directory Structure</h2>");
      expect(result).toContain("<h2>Permissions</h2>");
      expect(result).toContain("<td>Total Files</td>");
      expect(result).toContain("<td>1000</td>");
      expect(result).toContain("<td>Empty Directories</td>");
      expect(result).toContain("<td>5</td>");
    });

    it("should handle createZipArchive with mixed data scenarios", async () => {
      const mockArchive = {
        file: jest.fn(),
        on: jest.fn(),
        finalize: jest.fn(),
      };

      (archiver as jest.Mock).mockReturnValue(mockArchive);

      const dataChunks = [
        Buffer.from("chunk1"),
        Buffer.from("chunk2"),
        Buffer.from("chunk3"),
      ];

      mockArchive.on.mockImplementation((event, callback) => {
        if (event === "data") {
          dataChunks.forEach((chunk, index) => {
            setTimeout(() => callback(chunk), index * 5);
          });
        } else if (event === "end") {
          setTimeout(() => callback(), 50);
        }
        return mockArchive;
      });

      const result = await service.createZipArchive([
        "/path/to/file1.csv",
        "/path/to/file2.csv",
      ]);

      expect(result).toEqual(Buffer.concat(dataChunks));
      expect(mockArchive.file).toHaveBeenCalledTimes(2);
    });
  });
});
