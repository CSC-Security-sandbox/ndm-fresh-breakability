import { Test, TestingModule } from '@nestjs/testing';
import { DiscoveryService } from './discovery.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InventoryEntity } from '../entities/inventory.entity';
import { ReportsEntity } from '../entities/reports.entity';
import * as fs from 'fs';
import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import * as validation from '../utils/utils';
import * as puppeteer from 'puppeteer';

jest.mock('puppeteer', () => {
  const mockPuppeteer = {
    launch: jest.fn().mockResolvedValue({
      newPage: jest.fn().mockResolvedValue({
        setContent: jest.fn().mockResolvedValue(null),
        pdf: jest.fn().mockResolvedValue(Buffer.from('mock pdf')),
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
          provide: 'SANITIZE_HTML',
          useValue: mockSanitizeHtml,
        },
        {
          provide: 'ESCAPE_HTML',
          useValue: mockEscapeHtml,
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
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe("getReportsAsZip", () => {
    it("should create zip archive of reports", async () => {
      const jobRunIds = ["job123"];
      const reportType = "discovery";
      const mockZipBuffer = Buffer.from("mock zip content");

      jest
        .spyOn(fs, "existsSync")
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true);

      jest.spyOn(service, "createZipArchive").mockResolvedValue(mockZipBuffer);

      const result = await service.getReportsAsZip(jobRunIds, reportType);

      expect(result).toEqual(mockZipBuffer);
    });

    it("should throw error when no files found", async () => {
      const jobRunIds = ["job123"];
      const reportType = "discovery";

      jest
        .spyOn(fs, "existsSync")
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

      await expect(
        service.getReportsAsZip(jobRunIds, reportType)
      ).rejects.toThrow(NotFoundException);
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

  describe("generateHtmlTable", () => {
    it("should generate HTML table from data", () => {
      const mockData = [
        { category: "Files", sub_category: "Total", value: "100" },
        { category: "Files", sub_category: "Processed", value: "50" },
      ];

      const result = service.generateHtmlTable(mockData);

      expect(result).toContain("<table>");
      expect(result).toContain("Files");
      expect(result).toContain("100");
      expect(result).toContain("50");
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
        },
      ];
      const mockFilePath = "test.txt";
      const writeFileSpy = jest.spyOn(fs, "writeFileSync").mockImplementation();
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      service.formatAndWriteToFile(mockData, mockFilePath);

      writeFileSpy.mockRestore();
      consoleSpy.mockRestore();
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
    });

    it("should return default directory when environment variable is not set", () => {
      delete process.env.REPORT_DOWNLOAD_LOCATION;
      expect(service.getReportsDirectory).toBe("./reports");
    });

    describe("generatePdfFromData", () => {
      it("should generate a PDF buffer from report data", async () => {
        const mockData = [
          { category: "Files", sub_category: "Total", value: "100" },
        ];
        const pdfBuffer = await service.generatePdfFromData(mockData);
        expect(pdfBuffer).toBeInstanceOf(Buffer);
        expect(pdfBuffer.toString()).toContain("mock pdf");
      });
    });

    describe("createJobsPDFReportData", () => {
      it("should call the jobs_report_data_v2 procedure and return success message", async () => {
        mockInventoryRepo.query.mockResolvedValue([]);
        process.env.SCHEMA = "myschema";
        const jobRunId = "job-xyz";
        const result = await service.createJobsPDFReportData(jobRunId);
        expect(result).toEqual({
          message: "Report data generated successfully for jobs report",
        });
        expect(mockInventoryRepo.query).toHaveBeenCalledWith(
          `CALL ${process.env.SCHEMA}.jobs_report_data_v2($1::UUID, $2);`,
          [jobRunId, process.env.SCHEMA]
        );
      });

      it("should throw InternalServerErrorException if procedure fails", async () => {
        mockInventoryRepo.query.mockRejectedValue(new Error("fail"));
        await expect(
          service.createJobsPDFReportData("job-err")
        ).rejects.toThrow(InternalServerErrorException);
      });

      describe("generatePdfFromData", () => {
        it("should generate a PDF buffer from valid report data", async () => {
          const mockData = [
            { category: "Files", sub_category: "Total", value: "100" },
            { category: "Files", sub_category: "Processed", value: "50" },
          ];
          const pdfBuffer = await service.generatePdfFromData(mockData);
          expect(pdfBuffer).toBeInstanceOf(Buffer);
          expect(pdfBuffer.toString()).toContain("mock pdf");
        });

        it("should call generateHtmlTable with the provided data", async () => {
          const mockData = [
            { category: "Test", sub_category: "Sub", value: "1" },
          ];
          const htmlSpy = jest.spyOn(service, "generateHtmlTable");
          await service.generatePdfFromData(mockData);
          expect(htmlSpy).toHaveBeenCalledWith(mockData);
          htmlSpy.mockRestore();
        });

        it("should throw if puppeteer.launch throws", async () => {
          const mockData = [
            { category: "Error", sub_category: "Test", value: "0" },
          ];
          puppeteer.launch.mockRejectedValueOnce(new Error("Puppeteer failed"));
          await expect(service.generatePdfFromData(mockData)).rejects.toThrow(
            "Puppeteer failed"
          );
        });

        it("should generate a PDF buffer from valid report data", async () => {
          const mockData = [
            { category: "Files", sub_category: "Total", value: "100" },
            { category: "Files", sub_category: "Processed", value: "50" },
          ];
          const pdfBuffer = await service.generatePdfFromData(mockData);
          expect(pdfBuffer).toBeInstanceOf(Buffer);
          expect(pdfBuffer.toString()).toContain("mock pdf");
        });

        it("should call generateHtmlTable with the provided data", async () => {
          const mockData = [
            { category: "Test", sub_category: "Sub", value: "1" },
          ];
          const htmlSpy = jest.spyOn(service, "generateHtmlTable");
          await service.generatePdfFromData(mockData);
          expect(htmlSpy).toHaveBeenCalledWith(mockData);
          htmlSpy.mockRestore();
        });

        it("should throw if puppeteer.launch throws", async () => {
          const mockData = [
            { category: "Error", sub_category: "Test", value: "0" },
          ];
          (puppeteer.launch as jest.Mock).mockRejectedValueOnce(
            new Error("Puppeteer failed")
          );
          await expect(service.generatePdfFromData(mockData)).rejects.toThrow(
            "Puppeteer failed"
          );
        });
      });
    });
  });

  describe('generatePdfFromData', () => {
    it('should sanitize and escape HTML in report data', async () => {
      const maliciousData = [
        {
          category: '<script>alert("xss")</script>',
          sub_category: 'Total <b>Files</b>',
          value: '<img src=x onerror=alert(1)>'
        }
      ];

      const mockPdfBuffer = Buffer.from('mock pdf');
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
      expect(htmlArg).not.toContain('<script>');
      expect(htmlArg).not.toContain('<img');
    });
  });
});
