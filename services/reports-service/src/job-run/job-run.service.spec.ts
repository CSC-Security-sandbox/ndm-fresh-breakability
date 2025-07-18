import { Test, TestingModule } from "@nestjs/testing";
import { JobRunService } from "./job-run.service";
import { getRepositoryToken } from "@nestjs/typeorm";
import { JobRunEntity } from "../entities/jobrun.entity";
import { InventoryEntity } from "../entities/inventory.entity";
import { TaskEntity } from "../entities/task.entity";
import { ReportsEntity } from "../entities/reports.entity";
import { CsvService } from "../csv/csv_export.service";
import { NotFoundException, NotAcceptableException } from "@nestjs/common";
import { JobType, JobRunStatus, ReportType } from "../constants/enums";
import * as fs from "fs";
import * as path from "path";

// Mock fs module
jest.mock("fs", () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

// Mock crypto module
jest.mock("crypto", () => ({
  createHash: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue("mocked-hash"),
  }),
}));

describe("JobRunService", () => {
  let service: JobRunService;
  let mockJobRunRepo: any;
  let mockInventoryRepo: any;
  let mockTaskRepo: any;
  let mockReportsRepo: any;
  let mockCsvService: any;

  beforeEach(async () => {
    mockJobRunRepo = {
      findOne: jest.fn(),
      update: jest.fn(),
    };

    mockInventoryRepo = {
      createQueryBuilder: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      }),
    };

    mockTaskRepo = {
      createQueryBuilder: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      }),
    };

    mockReportsRepo = {
      findOne: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      }),
    };

    mockCsvService = {
      generateCsv: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobRunService,
        {
          provide: getRepositoryToken(JobRunEntity),
          useValue: mockJobRunRepo,
        },
        {
          provide: getRepositoryToken(InventoryEntity),
          useValue: mockInventoryRepo,
        },
        {
          provide: getRepositoryToken(TaskEntity),
          useValue: mockTaskRepo,
        },
        {
          provide: getRepositoryToken(ReportsEntity),
          useValue: mockReportsRepo,
        },
        {
          provide: CsvService,
          useValue: mockCsvService,
        },
      ],
    }).compile();

    service = module.get<JobRunService>(JobRunService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("jobRunReportByJobRunId", () => {
    it("should return report data when report exists", async () => {
      const mockReport = {
        reportData: JSON.stringify({ jobId: "test-123", status: "COMPLETED" }),
      };
      mockReportsRepo.findOne.mockResolvedValue(mockReport);

      const result = await service.jobRunReportByJobRunId("job-123", "COC");

      expect(result).toBe(mockReport.reportData);
      expect(mockReportsRepo.findOne).toHaveBeenCalledWith({
        where: { jobRunId: "job-123", reportType: "COC" },
        order: { createdAt: "DESC" },
        select: ["reportData"],
      });
    });

    it("should throw NotFoundException when report does not exist", async () => {
      mockReportsRepo.findOne.mockResolvedValue(null);

      await expect(
        service.jobRunReportByJobRunId("job-123", "COC")
      ).rejects.toThrow(
        new NotFoundException("COC - report is not generated yet")
      );
    });

    it("should handle empty reportType", async () => {
      const mockReport = {
        reportData: JSON.stringify({ jobId: "test-123" }),
      };
      mockReportsRepo.findOne.mockResolvedValue(mockReport);

      const result = await service.jobRunReportByJobRunId("job-123", "");

      expect(result).toBe(mockReport.reportData);
    });

    it("should handle special characters in parameters", async () => {
      const mockReport = {
        reportData: JSON.stringify({ jobId: "test-123" }),
      };
      mockReportsRepo.findOne.mockResolvedValue(mockReport);

      const result = await service.jobRunReportByJobRunId(
        "job-123!@#",
        "COC-Test"
      );

      expect(result).toBe(mockReport.reportData);
    });

    it("should handle very large report data", async () => {
      const largeData = "x".repeat(10000);
      const mockReport = {
        reportData: JSON.stringify({ data: largeData }),
      };
      mockReportsRepo.findOne.mockResolvedValue(mockReport);

      const result = await service.jobRunReportByJobRunId("job-123", "COC");

      expect(result).toBe(mockReport.reportData);
      expect(JSON.parse(result).data).toBe(largeData);
    });

    it("should handle repository errors", async () => {
      mockReportsRepo.findOne.mockRejectedValue(new Error("Database error"));

      await expect(
        service.jobRunReportByJobRunId("job-123", "COC")
      ).rejects.toThrow("Database error");
    });
  });

  describe("getJobStatsId", () => {
    it("should return saved report when exists and isReportReady matches", async () => {
      const savedReport = {
        reportData: JSON.stringify({
          id: "job-123",
          status: "COMPLETED",
          isReportReady: true,
        }),
      };

      mockJobRunRepo.findOne.mockResolvedValueOnce({ isReportReady: true });
      mockReportsRepo.findOne.mockResolvedValue(savedReport);

      const result = await service.getJobStatsId("job-123");

      expect(result).toEqual(JSON.parse(savedReport.reportData));
      expect(mockReportsRepo.update).not.toHaveBeenCalled();
    });

    it("should throw NotFoundException when job run not found", async () => {
      mockJobRunRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.getJobStatsId("job-123")).rejects.toThrow(
        new NotFoundException("Job run not found for id job-123")
      );
    });

    it("should update saved report when isReportReady differs", async () => {
      const savedReport = {
        reportData: JSON.stringify({
          id: "job-123",
          status: "COMPLETED",
          isReportReady: false,
        }),
      };

      mockJobRunRepo.findOne.mockResolvedValueOnce({ isReportReady: true });
      mockReportsRepo.findOne.mockResolvedValue(savedReport);

      const result = await service.getJobStatsId("job-123");

      expect(result.isReportReady).toBe(true);
      expect(mockReportsRepo.update).toHaveBeenCalledWith(
        { jobRunId: "job-123", reportType: ReportType.JOB_RUN_STATS },
        { reportData: expect.stringContaining('"isReportReady":true') }
      );
    });

    it("should handle complex job run data when no saved report exists", async () => {
      const mockJobRun = {
        id: "job-123",
        startTime: new Date("2023-01-01T00:00:00Z"),
        endTime: new Date("2023-01-01T01:00:00Z"),
        status: JobRunStatus.Completed,
        isReportReady: true,
        jobConfig: {
          id: "config-123",
          jobType: JobType.Migrate,
          sourcePath: {
            volumePath: "/source/path",
            fileServer: {
              protocol: "NFS",
              config: { configName: "source-server" },
            },
          },
          destinationPath: {
            volumePath: "/dest/path",
            fileServer: {
              protocol: "SMB",
              config: { configName: "dest-server" },
            },
          },
        },
        worker: [{ workerId: "worker-1" }],
      };

      mockJobRunRepo.findOne
        .mockResolvedValueOnce({ isReportReady: false })
        .mockResolvedValueOnce(mockJobRun);
      mockReportsRepo.findOne.mockResolvedValue(null);

      const mockInventoryStats = [
        { isDirectory: false, counts: "100", totalFileSize: "1024000" },
        { isDirectory: true, counts: "10", totalFileSize: null },
      ];

      const mockTaskStats = [
        { status: "COMPLETED", count: "50" },
        { status: "FAILED", count: "5" },
      ];

      mockInventoryRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(mockInventoryStats),
      });

      mockTaskRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(mockTaskStats),
      });

      mockReportsRepo.create.mockReturnValue({
        id: "report-123",
        reportData: JSON.stringify({}),
        createdAt: "2023-01-01T00:00:00Z",
        jobRunId: "job-123",
        reportType: ReportType.JOB_RUN_STATS,
      });

      const result = await service.getJobStatsId("job-123");

      expect(result.id).toBe("job-123");
      expect(result.jobConfig.sourceServer.serverName).toBe("source-server");
      expect(result.jobConfig.destinationServer.serverName).toBe("dest-server");
      expect(result.worker).toBe(1);
      expect(result.migrate.fileCount).toBe("100");
      expect(result.migrate.directories).toBe("10");
      expect(result.task.completed).toBe(50);
      expect(result.task.failed).toBe(5);
    });

    it("should handle discovery job type", async () => {
      const mockJobRun = {
        id: "job-123",
        startTime: new Date(),
        endTime: new Date(),
        status: JobRunStatus.Completed,
        isReportReady: true,
        jobConfig: {
          id: "config-123",
          jobType: JobType.Discover,
          sourcePath: {
            volumePath: "/source/path",
            fileServer: {
              protocol: "NFS",
              config: { configName: "source-server" },
            },
          },
          destinationPath: {
            volumePath: "/dest/path",
            fileServer: {
              protocol: "SMB",
              config: { configName: "dest-server" },
            },
          },
        },
        worker: [],
      };

      mockJobRunRepo.findOne
        .mockResolvedValueOnce({ isReportReady: false })
        .mockResolvedValueOnce(mockJobRun);
      mockReportsRepo.findOne.mockResolvedValue(null);

      const result = await service.getJobStatsId("job-123");

      expect(result).toHaveProperty("discovery");
      expect(result.jobConfig.jobType).toBe(JobType.Discover);
      expect(result.worker).toBe(0);
    });
  });

  describe("getCocReportByJobRunId", () => {
    beforeEach(() => {
      process.env.REPORT_DOWNLOAD_LOCATION = "./reports";
    });

    it("should return existing file path when file exists", async () => {
      const mockJobRun = {
        id: "job-123",
        jobConfig: { jobType: JobType.Migrate },
      };
      const expectedPath = "reports/job-123-coc-report.csv";

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      (path.join as jest.Mock).mockReturnValue(expectedPath);
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const result = await service.getCocReportByJobRunId("job-123");

      expect(result).toBe(expectedPath);
      expect(mockCsvService.generateCsv).not.toHaveBeenCalled();
    });

    it("should generate CSV and return path when file does not exist", async () => {
      const mockJobRun = {
        id: "job-123",
        jobConfig: { jobType: JobType.Migrate },
      };
      const expectedPath = "reports/job-123-coc-report.csv";
      const mockBuffer = Buffer.from("csv,data\n1,test");

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      (path.join as jest.Mock).mockReturnValue(expectedPath);
      (fs.existsSync as jest.Mock)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(mockBuffer);
      mockCsvService.generateCsv.mockResolvedValue(undefined);

      const mockReport = {
        id: "report-123",
        reportData: JSON.stringify({
          filePath: expectedPath,
          size: mockBuffer.length,
          digest: "mocked-hash",
        }),
        createdAt: "2023-01-01T00:00:00Z",
        jobRunId: "job-123",
        reportType: ReportType.COC,
      };
      mockReportsRepo.create.mockReturnValue(mockReport);

      const result = await service.getCocReportByJobRunId("job-123");

      expect(result).toBe(expectedPath);
      expect(mockCsvService.generateCsv).toHaveBeenCalledWith(
        expectedPath,
        "job-123"
      );
      expect(mockReportsRepo.create).toHaveBeenCalledWith({
        jobRunId: "job-123",
        reportData: JSON.stringify({
          filePath: expectedPath,
          size: mockBuffer.length,
          digest: "mocked-hash",
        }),
        reportType: ReportType.COC,
      });
    });

    it("should throw NotFoundException when job run not found", async () => {
      mockJobRunRepo.findOne.mockResolvedValue(null);

      await expect(service.getCocReportByJobRunId("job-123")).rejects.toThrow(
        new NotFoundException("Job Run with id job-123 not found")
      );
    });

    it("should throw NotFoundException when job is discovery type", async () => {
      const discoveryJobRun = {
        id: "job-123",
        jobConfig: { jobType: JobType.Discover },
      };

      mockJobRunRepo.findOne.mockResolvedValue(discoveryJobRun);

      await expect(service.getCocReportByJobRunId("job-123")).rejects.toThrow(
        new NotFoundException("Job Run with id job-123 is not a migration job")
      );
    });

    it("should throw NotAcceptableException for invalid file path", async () => {
      const mockJobRun = {
        id: "job-123",
        jobConfig: { jobType: JobType.Migrate },
      };
      const invalidPath = "../../../etc/passwd";

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      (path.join as jest.Mock).mockReturnValue(invalidPath);
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(service.getCocReportByJobRunId("job-123")).rejects.toThrow(
        new NotAcceptableException(`Invalid file path: ${invalidPath}`)
      );
    });

    it("should update report status for non-cutover jobs", async () => {
      const mockJobRun = {
        id: "job-123",
        jobConfig: { jobType: JobType.Migrate },
      };
      const expectedPath = "reports/job-123-coc-report.csv";
      const mockBuffer = Buffer.from("csv,data\n1,test");

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      (path.join as jest.Mock).mockReturnValue(expectedPath);
      (fs.existsSync as jest.Mock)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(mockBuffer);
      mockCsvService.generateCsv.mockResolvedValue(undefined);

      const mockReport = {
        id: "report-123",
        reportData: JSON.stringify({}),
        createdAt: "2023-01-01T00:00:00Z",
        jobRunId: "job-123",
        reportType: ReportType.COC,
      };
      mockReportsRepo.create.mockReturnValue(mockReport);

      const result = await service.getCocReportByJobRunId("job-123");

      expect(result).toBe(expectedPath);
      expect(mockJobRunRepo.update).toHaveBeenCalledWith(
        { id: "job-123" },
        { isReportReady: true }
      );
    });

    it("should not update report status for cutover jobs", async () => {
      const mockJobRun = {
        id: "job-123",
        jobConfig: { jobType: JobType.CutOver },
      };
      const expectedPath = "reports/job-123-coc-report.csv";
      const mockBuffer = Buffer.from("csv,data\n1,test");

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      (path.join as jest.Mock).mockReturnValue(expectedPath);
      (fs.existsSync as jest.Mock)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(mockBuffer);
      mockCsvService.generateCsv.mockResolvedValue(undefined);

      const mockReport = {
        id: "report-123",
        reportData: JSON.stringify({}),
        createdAt: "2023-01-01T00:00:00Z",
        jobRunId: "job-123",
        reportType: ReportType.COC,
      };
      mockReportsRepo.create.mockReturnValue(mockReport);

      const result = await service.getCocReportByJobRunId("job-123");

      expect(result).toBe(expectedPath);
      expect(mockJobRunRepo.update).not.toHaveBeenCalled();
    });

    it("should handle custom report download location", async () => {
      process.env.REPORT_DOWNLOAD_LOCATION = "/custom/reports";
      const mockJobRun = {
        id: "job-123",
        jobConfig: { jobType: JobType.Migrate },
      };
      const expectedPath = "/custom/reports/job-123-coc-report.csv";

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      (path.join as jest.Mock).mockReturnValue(expectedPath);
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const result = await service.getCocReportByJobRunId("job-123");

      expect(result).toBe(expectedPath);
      expect(path.join).toHaveBeenCalledWith(
        "/custom/reports",
        "job-123-coc-report.csv"
      );
    });

    it("should handle CSV generation error", async () => {
      const mockJobRun = {
        id: "job-123",
        jobConfig: { jobType: JobType.Migrate },
      };
      const expectedPath = "reports/job-123-coc-report.csv";

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      (path.join as jest.Mock).mockReturnValue(expectedPath);
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      mockCsvService.generateCsv.mockRejectedValue(
        new Error("CSV generation failed")
      );

      await expect(service.getCocReportByJobRunId("job-123")).rejects.toThrow(
        new NotFoundException(
          "Error while generating report for jobRunId: job-123"
        )
      );
    });

    describe("getJobStatsId - additional scenarios", () => {
      const jobId = "test-job-id";

      it("should return parsed report if saved report exists and isReportReady matches", async () => {
        const savedReport = {
          reportData: JSON.stringify({ isReportReady: true, foo: "bar" }),
        };
        mockJobRunRepo.findOne.mockResolvedValueOnce({ isReportReady: true }); // getLatestReportStatus
        mockReportsRepo.findOne.mockResolvedValueOnce(savedReport);

        const result = await service.getJobStatsId(jobId);

        expect(result).toEqual({ isReportReady: true, foo: "bar" });
        expect(mockReportsRepo.update).not.toHaveBeenCalled();
      });

      it("should update report if saved report exists and isReportReady does not match", async () => {
        const savedReport = {
          reportData: JSON.stringify({ isReportReady: false, foo: "bar" }),
        };
        mockJobRunRepo.findOne.mockResolvedValueOnce({ isReportReady: true }); // getLatestReportStatus
        mockReportsRepo.findOne.mockResolvedValueOnce(savedReport);

        await service.getJobStatsId(jobId);

        expect(mockReportsRepo.update).toHaveBeenCalledWith(
          { jobRunId: jobId, reportType: ReportType.JOB_RUN_STATS },
          { reportData: expect.any(String) }
        );
      });

      it("should throw NotFoundException if jobRun does not exist after reportTypes", async () => {
        mockJobRunRepo.findOne
          .mockResolvedValueOnce({ isReportReady: true }) // getLatestReportStatus
          .mockResolvedValueOnce(null); // jobRun
        mockReportsRepo.findOne.mockResolvedValueOnce(null);
        mockReportsRepo.createQueryBuilder().getRawMany.mockResolvedValue([]);

        await expect(service.getJobStatsId(jobId)).rejects.toThrow(
          new NotFoundException(`Job Run does not exist for id: ${jobId}`)
        );
      });

      it("should set worker to 0 if jobRun.worker is undefined", async () => {
        const mockJobRun = {
          id: jobId,
          startTime: new Date(),
          status: JobRunStatus.Completed,
          isReportReady: true,
          jobConfig: {
            id: "configId",
            jobType: JobType.Discover,
            sourcePath: {
              fileServer: {
                protocol: "http",
                config: { configName: "sourceServer" },
              },
              volumePath: "/source",
            },
            destinationPath: {
              fileServer: {
                protocol: "ftp",
                config: { configName: "destServer" },
              },
              volumePath: "/destination",
            },
          },
          worker: undefined,
        };
        mockJobRunRepo.findOne
          .mockResolvedValueOnce({ isReportReady: true }) // getLatestReportStatus
          .mockResolvedValueOnce(mockJobRun); // jobRun
        mockReportsRepo.findOne.mockResolvedValueOnce(null);
        mockReportsRepo.createQueryBuilder().getRawMany.mockResolvedValue([]);
        mockInventoryRepo.createQueryBuilder().getRawMany.mockResolvedValue([]);
        mockTaskRepo.createQueryBuilder().getRawMany.mockResolvedValue([]);

        const result = await service.getJobStatsId(jobId);
        expect(result.worker).toBe(0);
      });

      it('should handle empty inventory summary and set totalSize to "0"', async () => {
        const mockJobRun = {
          id: jobId,
          startTime: new Date(),
          status: JobRunStatus.Completed,
          isReportReady: true,
          jobConfig: {
            id: "configId",
            jobType: JobType.Discover,
            sourcePath: {
              fileServer: {
                protocol: "http",
                config: { configName: "sourceServer" },
              },
              volumePath: "/source",
            },
            destinationPath: {
              fileServer: {
                protocol: "ftp",
                config: { configName: "destServer" },
              },
              volumePath: "/destination",
            },
          },
          worker: [],
        };
        mockJobRunRepo.findOne
          .mockResolvedValueOnce({ isReportReady: true }) // getLatestReportStatus
          .mockResolvedValueOnce(mockJobRun); // jobRun
        mockReportsRepo.findOne.mockResolvedValueOnce(null);
        mockReportsRepo.createQueryBuilder().getRawMany.mockResolvedValue([]);
        mockInventoryRepo.createQueryBuilder().getRawMany.mockResolvedValue([]);
        mockTaskRepo.createQueryBuilder().getRawMany.mockResolvedValue([]);

        const result = await service.getJobStatsId(jobId);
        expect(result.discovery.totalSize).toBe("0");
      });

      it("should correctly map task status counts to response.task", async () => {
        const mockJobRun = {
          id: jobId,
          startTime: new Date(),
          status: JobRunStatus.Completed,
          isReportReady: true,
          jobConfig: {
            id: "configId",
            jobType: JobType.Discover,
            sourcePath: {
              fileServer: {
                protocol: "http",
                config: { configName: "sourceServer" },
              },
              volumePath: "/source",
            },
            destinationPath: {
              fileServer: {
                protocol: "ftp",
                config: { configName: "destServer" },
              },
              volumePath: "/destination",
            },
          },
          worker: [],
        };
        const mockTaskStatusCounts = [
          { status: "SUCCESS", count: "5" },
          { status: "FAILED", count: "2" },
        ];
        mockJobRunRepo.findOne
          .mockResolvedValueOnce({ isReportReady: true }) // getLatestReportStatus
          .mockResolvedValueOnce(mockJobRun); // jobRun
        mockReportsRepo.findOne.mockResolvedValueOnce(null);
        mockReportsRepo.createQueryBuilder().getRawMany.mockResolvedValue([]);
        mockInventoryRepo.createQueryBuilder().getRawMany.mockResolvedValue([]);
        mockTaskRepo
          .createQueryBuilder()
          .getRawMany.mockResolvedValue(mockTaskStatusCounts);

        const result = await service.getJobStatsId(jobId);
        expect(result.task.success).toBe(5);
        expect(result.task.failed).toBe(2);
      });
    });
  });

  describe("getJobSubStatus", () => {
    it("should return job sub status when job run exists", async () => {
      const mockJobRun = {
        id: "job-123",
        subStatus: "PAUSED",
      };

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);

      const result = await service.getJobSubStatus("job-123");

      expect(result).toBe(mockJobRun);
      expect(mockJobRunRepo.findOne).toHaveBeenCalledWith({
        where: { id: "job-123" },
        select: ["subStatus"],
      });
    });

    it("should return null when job run does not exist", async () => {
      mockJobRunRepo.findOne.mockResolvedValue(null);

      const result = await service.getJobSubStatus("job-123");

      expect(result).toBeNull();
    });

    it("should handle empty job run id", async () => {
      const mockJobRun = {
        id: "",
        subStatus: null,
      };

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);

      const result = await service.getJobSubStatus("");

      expect(result).toBe(mockJobRun);
    });

    it("should handle undefined subStatus", async () => {
      const mockJobRun = {
        id: "job-123",
        subStatus: undefined,
      };

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);

      const result = await service.getJobSubStatus("job-123");

      expect(result).toBe(mockJobRun);
    });
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

  describe("Edge Cases and Error Handling", () => {
    it("should handle malformed JSON in saved reports", async () => {
      const savedReport = {
        reportData: "{ malformed json }",
      };

      mockJobRunRepo.findOne.mockResolvedValueOnce({ isReportReady: true });
      mockReportsRepo.findOne.mockResolvedValue(savedReport);

      await expect(service.getJobStatsId("job-123")).rejects.toThrow();
    });

    it("should handle concurrent requests to the same job run", async () => {
      const promises = Array.from({ length: 5 }, (_, i) =>
        service.jobRunReportByJobRunId(`job-${i}`, "COC")
      );

      mockReportsRepo.findOne.mockResolvedValue({
        reportData: JSON.stringify({ data: "test" }),
      });

      const results = await Promise.all(promises);

      expect(results).toHaveLength(5);
      results.forEach((result) => {
        expect(result).toBe(JSON.stringify({ data: "test" }));
      });
    });

    it("should handle file system errors in getCocReportByJobRunId", async () => {
      const mockJobRun = {
        id: "job-123",
        jobConfig: { jobType: JobType.Migrate },
      };
      const expectedPath = "reports/job-123-coc-report.csv";

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      (path.join as jest.Mock).mockReturnValue(expectedPath);
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      mockCsvService.generateCsv.mockResolvedValue(undefined);
      // File doesn't exist after generation
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(service.getCocReportByJobRunId("job-123")).rejects.toThrow(
        new Error(`File not found: ${expectedPath}`)
      );
    });
  });

  describe("Service Initialization", () => {
    it("should be defined", () => {
      expect(service).toBeDefined();
    });

    it("should have all required methods", () => {
      expect(typeof service.jobRunReportByJobRunId).toBe("function");
      expect(typeof service.getJobStatsId).toBe("function");
      expect(typeof service.getCocReportByJobRunId).toBe("function");
      expect(typeof service.getJobSubStatus).toBe("function");
      expect(typeof service.getReportsDirectory).toBe("string");
    });
  });
});
