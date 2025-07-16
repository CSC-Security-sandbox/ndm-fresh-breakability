// discovery.service.spec.ts

// Properly mock puppeteer for both ES default and CJS
const launchMock = jest.fn().mockResolvedValue({
  newPage: jest.fn().mockResolvedValue({
    setContent: jest.fn().mockResolvedValue(null),
    pdf: jest.fn().mockResolvedValue(Buffer.from("mock pdf")),
  }),
  close: jest.fn().mockResolvedValue(null),
});

jest.mock("puppeteer", () => ({
  __esModule: true,
  default: { launch: launchMock },
  launch: launchMock,
}));

import { Test, TestingModule } from "@nestjs/testing";
import { DiscoveryService } from "./discovery.service";
import { getRepositoryToken } from "@nestjs/typeorm";
import { InventoryEntity } from "../entities/inventory.entity";
import { ReportsEntity } from "../entities/reports.entity";
import * as fs from "fs";
import * as path from "path";
import {
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import * as validation from "src/utils/utils";
import puppeteer from "puppeteer";

describe("DiscoveryService", () => {
  let service: DiscoveryService;
  let mockInventoryRepo;
  let mockReportsRepo;

  const dummyRecord = {
    fileServerPathId: "server1",
    path: "/root/path1",
    parentPath: "/root",
    name: "path1",
  };

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
  ]
  const reportEntries = [
    { category: "Cat1", sub_category: "Sub1", value: "10" },
    { category: "Cat1", sub_category: "Sub2", value: "20" },
  ];

  beforeEach(async () => {
    mockInventoryRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      query: jest.fn(),
    };
    mockReportsRepo = { find: jest.fn(), save: jest.fn() };

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

    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    jest.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);
  });

  afterEach(() => jest.resetAllMocks());

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
        .mockImplementation((filePath: string) => true || false);

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

      jest.spyOn(validation, 'validateFilePath').mockReturnValue(true);
      jest.spyOn(validation, "validateFilePath").mockReturnValue(true);
      mockInventoryRepo.query.mockResolvedValue([]);
      mockReportsRepo.find.mockResolvedValue([
        {
          reportData: JSON.stringify(reportEntries),
          jobRunId,
          reportType,
          createdAt: new Date(),
        },
      ]);
    });

    it("writes CSV and PDF and returns success message", async () => {
      jest
        .spyOn(service, "generatePdfFromData")
        .mockResolvedValue(Buffer.from("pdf"));
      const res = await service.createReportFile(jobRunId, reportType);
      expect(res).toEqual({ message: "Report generated successfully" });
      expect(fs.writeFileSync).toHaveBeenCalledTimes(2);
    });

    it("creates directory if missing", async () => {
      jest
        .spyOn(fs, "existsSync")
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);
      jest
        .spyOn(service, "generatePdfFromData")
        .mockResolvedValue(Buffer.from("pdf"));
      await service.createReportFile(jobRunId, reportType);
      expect(fs.mkdirSync).toHaveBeenCalledWith(service.getReportsDirectory, {
        recursive: true,
      });
    });

    it("throws InternalServerErrorException on proc failure", async () => {
      mockInventoryRepo.query.mockRejectedValue(new Error("fail"));
      await expect(
        service.createReportFile(jobRunId, reportType)
      ).rejects.toThrow(InternalServerErrorException);
    });

    it("throws if no report data", async () => {
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

  describe("generateHtmlTable", () => {
    it("builds correct HTML", () => {
      const html = service.generateHtmlTable(reportEntries);
      expect(html).toContain("<table>");
      expect(html).toContain("Cat1");
      expect(html).toContain("Sub2");
    });

    it("handles empty data", () => {
      expect(service.generateHtmlTable([])).toContain("Data Summary");
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

  describe("generatePdfFromData", () => {
    it("throws if launch fails", async () => {
      launchMock.mockRejectedValueOnce(new Error("bad"));
      await expect(service.generatePdfFromData(reportEntries)).rejects.toThrow(
        "bad"
      );
    });
  });

  describe("formatAndWriteToFile", () => {
    it("writes CSV with values", () => {
      const filePath = "test.csv";
      jest.spyOn(validation, "validateFilePath").mockReturnValue(true);
      service.formatAndWriteToFile(reportEntries, filePath);
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("10,20")
      );
    });

      const groupAndOrderSpy = jest
        .spyOn(require("../utils/group-order"), "groupAndOrder")
        .mockReturnValue({
          Files: [
            { sub_category: "Total", value: "100" },
            { sub_category: "Processed", value: "50" },
          ],
        });

      const result = service.generateHtmlTable(mockData);

      expect(result).toContain("<table>");
      expect(result).toContain("<h2>Files</h2>");
      expect(result).toContain(
        "<tr>\n            <th>Sub Category</th>\n            <th></th>\n          </tr>"
      );
      expect(result).toContain("Total");
      expect(result).toContain("Processed");
      expect(result).toContain("Files");
      expect(result).toContain("100");
      expect(result).toContain("50");
    });
  });

  describe("generatePdfFromData", () => {
    it("should generate PDF from data", async () => {
      const mockData = [
        {
          category: "Files",
          sub_category: "Total",
          valueType: "count",
          value: "100",
        },
      ];

      // Mock the HTML generation
      const mockHtml = "<html><body>Test HTML</body></html>";
      jest.spyOn(service, "generateHtmlTable").mockReturnValue(mockHtml);

      const result = await service.generatePdfFromData(mockData);

      expect(result).toBeInstanceOf(Buffer);
      expect(service.generateHtmlTable).toHaveBeenCalledWith(mockData);
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
    it('throws on invalid path', () => {
      jest.spyOn(validation, 'validateFilePath').mockReturnValue(false);
      expect(() => service.formatAndWriteToFile(reportEntries, 'bad')).toThrow();
    it("throws on invalid path", () => {
      jest.spyOn(validation, "validateFilePath").mockReturnValue(false);
      expect(() =>
        service.formatAndWriteToFile(reportEntries, "bad")
      ).toThrow();
    });
  });

  describe("createJobsPDFReportData", () => {
    it("executes repo.query and returns success", async () => {
      mockInventoryRepo.query.mockResolvedValue([]);
      const res = await service.createJobsPDFReportData("j1");
      expect(res).toEqual({ message: expect.stringContaining("jobs report") });
    });

    it("throws on failure", async () => {
      mockInventoryRepo.query.mockRejectedValue(new Error());
      await expect(service.createJobsPDFReportData("j1")).rejects.toThrow(
        InternalServerErrorException
      );
    });
  });

  describe("getDiscovery methods", () => {
    it("getDiscoveryByFileServerId returns nested structure", async () => {
      mockInventoryRepo.findOne.mockResolvedValue(dummyRecord);
      mockInventoryRepo.find.mockResolvedValue([dummyRecord]);
      const res = await service.getDiscoveryByFileServerId("server1");
      expect(res[0].root).toBe("path1");
    });

    it("getDiscoveryByFileServerIdAndParentPath returns childs array", async () => {
      mockInventoryRepo.find.mockResolvedValue([dummyRecord]);
      const res = await service.getDiscoveryByFileServerIdAndParentPath(
        "server1",
        "/root"
      );
      expect(res[0].childs).toEqual([]);
    });

    it("getDataFromParentPath calls repo.find", async () => {
      mockInventoryRepo.find.mockResolvedValue([dummyRecord]);
      const res = await service.getDataFromParentPath("server1", "/root");
      expect(res).toEqual([dummyRecord]);
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

  describe("getReportsDirectory", () => {
    it("should return custom directory from environment variable", () => {
      process.env.REPORT_DOWNLOAD_LOCATION = "/custom/path";
      expect(service.getReportsDirectory).toBe("/custom/path");
  describe('getReportsAsZip', () => {
    const reportType = 'discovery';
    it('throws if directory missing', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValueOnce(false);
      await expect(service.getReportsAsZip(['j'], reportType)).rejects.toThrow(NotFoundException);
  describe("getReportsAsZip", () => {
    const reportType = "discovery";
    it("throws if directory missing", async () => {
      jest.spyOn(fs, "existsSync").mockReturnValueOnce(false);
      await expect(service.getReportsAsZip(["j"], reportType)).rejects.toThrow(
        NotFoundException
      );
    });

    it("throws if no files found", async () => {
      jest
        .spyOn(fs, "existsSync")
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);
      await expect(service.getReportsAsZip(["j"], reportType)).rejects.toThrow(
        NotFoundException
      );
    });

    it("returns buffer when files exist", async () => {
      jest.spyOn(fs, "existsSync").mockReturnValue(true);
      jest
        .spyOn(service, "createZipArchive")
        .mockResolvedValue(Buffer.from("z"));
      const buf = await service.getReportsAsZip(["j"], reportType);
      expect(buf.toString()).toBe("z");
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
