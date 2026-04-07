import { Test, TestingModule } from "@nestjs/testing";
import { Logger, NotAcceptableException, NotFoundException } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";
import { JobRunService } from "./job-run.service";
import { JobRunEntity } from "src/entities/jobrun.entity";
import { InventoryEntity } from "src/entities/inventory.entity";
import { TaskEntity } from "src/entities/task.entity";
import { ReportsEntity } from "src/entities/reports.entity";
import { JobRunStatus, JobType, ReportType } from "src/constants/enums";
import { CsvService } from "src/csv/csv_export.service";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { find } from "rxjs";
import { JobStatsSummaryMvEntity } from "src/entities/job-stats-summary-mv.entity";
import { StorageOverviewSummaryEntity } from "src/entities/storage-summary-mv.entity";
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { ProjectIdCacheService } from '../utils/project-id-cache.service';
import * as firstline from "firstline";
import * as readLastLines from "read-last-lines";

jest.mock("firstline");
jest.mock("read-last-lines");

describe("JobRunService", () => {
  let service: JobRunService;
  let mockJobRunRepo;
  let mockInventoryRepo;
  let mockTaskRepo;
  let mockCsvService;
  let mockJobSummaryMvRepo;
  let mockStorageSummaryMvRepo;

  const mockCreateQueryBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawMany: jest
      .fn()
      .mockResolvedValue([
        { report_type: ReportType.COC },
        { report_type: ReportType.JOBS_RREPORT },
      ]),
  };

  const mockReportsRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    createQueryBuilder: jest.fn(() => ({
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        {
          job_run_id: "run123",
          report_type: "JOBS_REPORT",
          report_data: {
            stats: { total: 100 },
          },
        },
        {
          job_run_id: "run123",
          report_type: "COC",
          report_data: {
            summary: "some summary",
          },
        },
      ]),
      getRawMany: jest
        .fn()
        .mockResolvedValue([
          { report_type: ReportType.COC },
          { report_type: ReportType.JOBS_RREPORT },
        ]),
    })),
  };

  beforeEach(async () => {
    const mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest
        .fn()
        .mockResolvedValue([
          { report_type: ReportType.COC },
          { report_type: ReportType.JOBS_RREPORT },
        ]),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({}),
    };

    mockJobRunRepo = {
      findOne: jest.fn(),
      update: jest.fn(),
    };

    mockInventoryRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    mockTaskRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };
    mockJobSummaryMvRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
    };

    mockStorageSummaryMvRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
    };

    mockCsvService = {
      generateCsv: jest.fn(),
    };

    const mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobRunService,
        { provide: getRepositoryToken(JobRunEntity), useValue: mockJobRunRepo },
        {
          provide: getRepositoryToken(InventoryEntity),
          useValue: mockInventoryRepo,
        },
        { provide: getRepositoryToken(TaskEntity), useValue: mockTaskRepo },
        {
          provide: getRepositoryToken(ReportsEntity),
          useValue: mockReportsRepo,
        },
        { provide: CsvService, useValue: mockCsvService },
        {
          provide: getRepositoryToken(ReportsEntity),
          useValue: mockReportsRepo,
        },
        {
          provide: getRepositoryToken(JobStatsSummaryMvEntity),
          useValue: mockJobSummaryMvRepo,
        },
        {
          provide: getRepositoryToken(StorageOverviewSummaryEntity),
          useValue: mockStorageSummaryMvRepo,
        },
        {
          provide: LoggerFactory,
          useValue: {
            create: jest.fn().mockReturnValue(mockLogger),
          },
        },
        {
          provide: ProjectIdCacheService,
          useValue: {
            getProjectIdFromCache: jest.fn().mockResolvedValue('project-123'),
          },
        },
      ],
    }).compile();

    service = module.get<JobRunService>(JobRunService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });


  describe("jobRunReportByJobRunId", () => {
    const jobRunId = "12345";

    it("should return report data when found", async () => {
      const mockReport = { reportData: '{"test": "data"}' };
      mockReportsRepo.findOne.mockResolvedValue(mockReport);

      const result = await service.jobRunReportByJobRunId(jobRunId, "");

      expect(mockReportsRepo.findOne).toHaveBeenCalledWith({
        where: { jobRunId, reportType: "" },
        order: { createdAt: "DESC" },
        select: ["reportData"],
      });

      expect(result).toEqual(mockReport.reportData);
    });

    it("should return NotFoundException when no report exists", async () => {
      mockReportsRepo.findOne.mockResolvedValue(null);

      await expect(
        service.jobRunReportByJobRunId(jobRunId, "DISCOVERY")
      ).rejects.toThrow(
        new NotFoundException("DISCOVERY - report is not generated yet")
      );
    });
  });

  describe("getJobStatsId", () => {
    it("should throw NotFoundException if jobRun does not exist", async () => {
      mockJobRunRepo.findOne.mockResolvedValue(null);
      await expect(service.getJobStatsId("bad-id")).rejects.toThrow(
        NotFoundException
      );
    });
    it("should include lastRefreshed in the response", async () => {
      const jobId = "12345";
      const sourceDirectoryPath = "/reports/source/dir";
      const destinationDirectoryPath = "/reports/destination/dir";
      const mockJobRun = {
        id: jobId,
        startTime: new Date(),
        status: JobRunStatus.Completed,
        jobConfig: {
          id: "configId",
          jobType: JobType.Migrate,
          sourceDirectoryPath,
          sourcePath: {
            fileServer: {
              protocol: "http",
              config: { configName: "sourceServer" },
            },
            volumePath: "/source",
          },
          destinationDirectoryPath,
          destinationPath: {
            fileServer: {
              protocol: "ftp",
              config: { configName: "destServer" },
            },
            volumePath: "/destination",
          },
        },
        options: {
          preserveAccessTime: true,
          excludeOlderThan: new Date("2025-01-01T00:00:00Z"),
          excludeFilePatterns: "*.tmp",
          skipFile: "x-M",
          identityMappingId: "mapping-123",
        },
        worker: { workerId: "worker1" },
      };

      const mockJobStatsSummary = {
        fileCount: 50,
        directoryCount: 10,
        totalSize: 1024,
        lastRefreshed: new Date("2025-08-29T12:00:00Z"),
      };

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      mockJobSummaryMvRepo.findOne.mockResolvedValue(mockJobStatsSummary);

      const result = await service.getJobStatsId(jobId);

      expect(result.lastRefreshed).toEqual(mockJobStatsSummary.lastRefreshed);
      expect(result.jobConfig.sourceServer.directoryPath).toBe(sourceDirectoryPath);
      expect(result.jobConfig.destinationServer.directoryPath).toBe(
        destinationDirectoryPath
      );
    });
    const jobId = "12345";

    it("should return job stats with discovery data", async () => {
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
        options: {
          preserveAccessTime: true,
          excludeOlderThan: null,
          excludeFilePatterns: "*.tmp",
          skipFile: null,
          identityMappingId: null,
        },
        worker: { workerId: "worker1" },
      };

      const mockInventorySummary = [
        { isDirectory: true, counts: "10", totalFileSize: "0" },
        { isDirectory: false, counts: "50", totalFileSize: "1024" },
      ];

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      mockJobSummaryMvRepo.findOne.mockResolvedValue({
        fileCount: 50,
        directoryCount: 10,
        totalSize: 1024,
      });

      const result = await service.getJobStatsId(jobId);

      expect(result.discovery).toBeDefined();
      expect(result.discovery.directories).toBe("10");
      expect(result.discovery.fileCount).toBe("50");
    });

    it("should return job stats with migrate data", async () => {
      const mockJobRun = {
        id: jobId,
        startTime: new Date(),
        status: JobRunStatus.Completed,
        isReportReady: true,
        jobConfig: {
          id: "configId",
          jobType: JobType.Migrate,
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
        options: {
          preserveAccessTime: true,
          excludeOlderThan: new Date("2025-01-01T00:00:00Z"),
          excludeFilePatterns: "*.tmp",
          skipFile: "x-M",
          identityMappingId: "mapping-123",
        },
        worker: { workerId: "worker1" },
      };
      const mockGetRawMany = [{ count: "1" }];
      mockJobSummaryMvRepo.findOne.mockResolvedValue({
        fileCount: 25,
        directoryCount: 5,
        totalSize: 2048,
      });

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      const result = await service.getJobStatsId(jobId);
      expect(result.migrate).toBeDefined();
    });

    it("should return job stats with cutover data", async () => {
      const mockJobRun = {
        id: jobId,
        startTime: new Date(),
        status: JobRunStatus.Completed,
        isReportReady: true,
        jobConfig: {
          id: "configId",
          jobType: JobType.CutOver,
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
        options: {
          preserveAccessTime: true,
          excludeOlderThan: new Date("2025-01-01T00:00:00Z"),
          excludeFilePatterns: "*.tmp",
          skipFile: null,
          identityMappingId: null,
        },
        worker: { workerId: "worker1" },
      };

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      const result = await service.getJobStatsId(jobId);
      expect(result.cutOver).toBeDefined();
    });

    it("should save report when job is completed", async () => {
      const mockJobRun = {
        id: jobId,
        status: JobRunStatus.Completed,
        jobConfig: {
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
        options: {
          preserveAccessTime: true,
          excludeOlderThan: null,
          excludeFilePatterns: "*.tmp",
          skipFile: null,
          identityMappingId: null,
        },
        worker: { workerId: "worker1" },
      };

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      mockReportsRepo.create.mockReturnValue({});
      mockReportsRepo.save.mockResolvedValue({});

      const result = await service.getJobStatsId(jobId);
      expect(result).toBeDefined();
    });

    it("should update existing report when report exists", async () => {
      const mockJobRun = {
        id: jobId,
        isReportReady: true,
      };

      const existingReport = {
        reportData: JSON.stringify({ isReportReady: false }),
      };

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      mockReportsRepo.findOne.mockResolvedValue(existingReport);

      await service.getJobStatsId(jobId);

      expect(mockReportsRepo.update).toHaveBeenCalledWith(
        { jobRunId: jobId, reportType: ReportType.JOB_RUN_STATS },
        { reportData: expect.any(String) }
      );
    });

    it("should throw NotFoundException if job run does not exist", async () => {
      mockJobRunRepo.findOne.mockResolvedValue(null);

      await expect(service.getJobStatsId("non-existent-id")).rejects.toThrow(
        NotFoundException
      );
    });

    it("should update isReportReady to true if both COC & JOBS_REPORT exist", async () => {
      mockJobRunRepo.findOne.mockResolvedValue({
        ...mockJobRunRepo,
        isReportReady: false,
      });
      mockReportsRepo.findOne.mockResolvedValue(null);
      mockJobRunRepo.update = jest.fn();

      await service.getJobStatsId(jobId);

      expect(mockJobRunRepo.update).toHaveBeenCalledWith(
        { id: jobId },
        { isReportReady: true }
      );
    });

    it("should not update report when isReportReady is already the same", async () => {
      const mockJobRun = {
        id: jobId,
        isReportReady: true,
      };
      const existingReport = {
        reportData: JSON.stringify({ isReportReady: true }),
      };

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      mockReportsRepo.findOne.mockResolvedValue(existingReport);
      mockJobSummaryMvRepo.findOne.mockResolvedValue(null);

      const result = await service.getJobStatsId(jobId);

      expect(mockReportsRepo.update).not.toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("should add lastRefreshed from jobStatsSummary when saved report exists", async () => {
      const mockJobRun = {
        id: jobId,
        isReportReady: true,
      };
      const existingReport = {
        reportData: JSON.stringify({ isReportReady: true }),
      };
      const mockLastRefreshed = new Date("2025-08-29T12:00:00Z");

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      mockReportsRepo.findOne.mockResolvedValue(existingReport);
      mockJobSummaryMvRepo.findOne.mockResolvedValue({
        lastRefreshed: mockLastRefreshed,
      });

      const result = await service.getJobStatsId(jobId);

      expect(result.lastRefreshed).toEqual(mockLastRefreshed);
    });

    it("should override cached report stats with snapshot when hasValidSnapshot is true", async () => {
      const endTime = new Date("2025-06-01T10:00:00Z");
      mockJobRunRepo.findOne.mockResolvedValueOnce({
        id: jobId,
        isReportReady: true,
        jobStats: { fileCount: "99", directories: "9", totalSize: "8192" },
        endTime,
      });
      const existingReport = {
        reportData: JSON.stringify({
          isReportReady: true,
          migrate: { fileCount: "0", directories: "0", totalSize: "0" },
        }),
      };
      mockReportsRepo.findOne.mockResolvedValue(existingReport);
      mockJobSummaryMvRepo.findOne.mockResolvedValue(null);

      const result = await service.getJobStatsId(jobId);

      expect(result.migrate.fileCount).toBe("99");
      expect(result.migrate.directories).toBe("9");
      expect(result.lastRefreshed).toEqual(endTime);
    });

    it("should use snapshot stats in fresh-build path when hasValidSnapshot is true", async () => {
      const endTime = new Date("2025-06-01T11:00:00Z");
      const mockFullJobRun = {
        id: jobId,
        startTime: new Date(),
        status: JobRunStatus.Completed,
        isReportReady: false,
        jobConfig: {
          id: "configId",
          jobType: JobType.Migrate,
          sourcePath: {
            fileServer: { protocol: "nfs", config: { configName: "src" } },
            volumePath: "/src",
          },
          destinationPath: {
            fileServer: { protocol: "smb", config: { configName: "dst" } },
            volumePath: "/dst",
          },
        },
        options: null,
        worker: [],
        endTime,
      };

      mockJobRunRepo.findOne
        .mockResolvedValueOnce({
          id: jobId,
          isReportReady: false,
          jobStats: { fileCount: "77", directories: "7", totalSize: "4096" },
          endTime,
        })
        .mockResolvedValueOnce(mockFullJobRun);
      mockReportsRepo.findOne.mockResolvedValue(null);
      mockJobSummaryMvRepo.findOne.mockResolvedValue(null);
      mockReportsRepo.create.mockReturnValue({});
      mockReportsRepo.save.mockResolvedValue({});

      const result = await service.getJobStatsId(jobId);

      expect(result.migrate.fileCount).toBe("77");
      expect(result.migrate.directories).toBe("7");
    });

    it("should return job options correctly in the response", async () => {
      const mockJobRun = {
        id: jobId,
        startTime: new Date(),
        status: JobRunStatus.Completed,
        jobConfig: {
          id: "configId",
          jobType: JobType.Migrate,
          sourcePath: {
            fileServer: {
              protocol: "nfs",
              config: { configName: "sourceServer" },
            },
            volumePath: "/source",
          },
          destinationPath: {
            fileServer: {
              protocol: "smb",
              config: { configName: "destServer" },
            },
            volumePath: "/destination",
          },
        },
        options: {
          preserveAccessTime: true,
          excludeOlderThan: new Date("2025-01-01T00:00:00Z"),
          excludeFilePatterns: "*.tmp,*.log",
          skipFile: "x-M",
          identityMappingId: "mapping-456",
        },
        worker: { workerId: "worker1" },
      };

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      mockReportsRepo.findOne.mockResolvedValue(null);
      mockJobSummaryMvRepo.findOne.mockResolvedValue({
        fileCount: 100,
        directoryCount: 20,
        totalSize: 2048,
      });

      const result = await service.getJobStatsId(jobId);

      expect(result.jobOptions).toBeDefined();
      expect(result.jobOptions.preserveAccessTime).toBe(true);
      expect(result.jobOptions.excludeOlderThan).toEqual(new Date("2025-01-01T00:00:00Z"));
      expect(result.jobOptions.excludeFilePatterns).toBe("*.tmp,*.log");
      expect(result.jobOptions.skipFile).toBe("x-M");
      expect(result.jobOptions.identityMappingId).toBe("mapping-456");
    });
  });

  describe("getJobStatsId - Inventory Summary Processing", () => {
    const jobId = "12345";

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should correctly process inventory summary for directories and files", async () => {
      const mockJobRun = {
        id: jobId,
        startTime: new Date(),
        status: JobRunStatus.Completed,
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
        options: {
          preserveAccessTime: true,
          excludeOlderThan: null,
          excludeFilePatterns: "*.tmp",
          skipFile: null,
          identityMappingId: null,
        },
        worker: { workerId: "worker1" },
      };

      const mockInventorySummary = [
        { isDirectory: true, counts: "10" },
        { isDirectory: false, counts: "50", totalFileSize: "500000" },
      ];

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      mockJobSummaryMvRepo.findOne.mockResolvedValue({
        fileCount: 50,
        directoryCount: 10,
        totalSize: 500000,
      });

      const result = await service.getJobStatsId(jobId);

      expect(result.discovery.directories).toBe("10");
      expect(result.discovery.fileCount).toBe("50");
    });

    it("should handle case when there are no files or directories", async () => {
      const mockJobRun = {
        id: jobId,
        startTime: new Date(),
        status: JobRunStatus.Completed,
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
        options: {
          preserveAccessTime: true,
          excludeOlderThan: null,
          excludeFilePatterns: "*.tmp",
          skipFile: null,
          identityMappingId: null,
        },
        worker: { workerId: "worker1" },
      };

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      mockJobSummaryMvRepo.findOne.mockResolvedValue(null);

      const result = await service.getJobStatsId(jobId);

      expect(result.discovery).toBeDefined();
      expect(result.discovery.totalSize).toBe("0");
    });
  });

  describe("getCocReportByJobRunId", () => {
    it("should throw NotFoundException if jobRun not found in getCocReportByJobRunId", async () => {
      mockJobRunRepo.findOne.mockResolvedValue(null);
      await expect(service.getCocReportByJobRunId("bad-id")).rejects.toThrow(
        NotFoundException
      );
    });

    it("should throw NotFoundException if jobType is Discover in getCocReportByJobRunId", async () => {
      mockJobRunRepo.findOne.mockResolvedValue({
        jobConfig: { jobType: JobType.Discover },
      });
      await expect(service.getCocReportByJobRunId("id")).rejects.toThrow(
        NotFoundException
      );
    });

    it("should throw NotAcceptableException for invalid file path in getCocReportByJobRunId", async () => {
      mockJobRunRepo.findOne.mockResolvedValue({
        jobConfig: { jobType: JobType.Migrate },
      });
      jest.spyOn(path, "join").mockReturnValue("/invalid/path.csv");
      await expect(service.getCocReportByJobRunId("id")).rejects.toThrow();
    });

    it("should throw error if file not found after generation in getCocReportByJobRunId", async () => {
      mockJobRunRepo.findOne.mockResolvedValue({
        jobConfig: { jobType: JobType.Migrate },
      });
      jest.spyOn(path, "join").mockReturnValue("./reports/id-coc-report.csv");
      jest
        .spyOn(fs.promises, "access")
        .mockRejectedValueOnce(new Error("not found"))  // CSV does not exist (skip early return)
        .mockRejectedValueOnce(new Error("not found")); // file not found after generation
      mockCsvService.generateCsv.mockResolvedValue(undefined);
      jest.spyOn(service as any, "createZipFile").mockResolvedValue(undefined);
      await expect(service.getCocReportByJobRunId("id")).rejects.toThrow();
    });
    const jobRunId = "12345";
    const mockJobRun = {
      id: jobRunId,
      jobConfig: {
        jobType: JobType.Migrate,
      },
    };
    const mockFilePath = `./reports/${jobRunId}-coc-report.csv`;

    it("should return the file path if the report already exists and update DB", async () => {
      jest.spyOn(path, "join").mockReturnValue(mockFilePath);
      // ZIP exists — short-circuits immediately, no CSV generation or report saving
      jest.spyOn(fs.promises, "access").mockResolvedValue(undefined);
      jest.spyOn(mockJobRunRepo, "findOne").mockResolvedValue(mockJobRun);

      const result = await service.getCocReportByJobRunId(jobRunId);

      expect(result).toBe(mockFilePath);
      // isReportReady must still be set even on short-circuit (crash recovery)
      expect(mockJobRunRepo.update).toHaveBeenCalledWith({ id: jobRunId }, { isReportReady: true });
      // report record is NOT re-saved on short-circuit — ZIP was already complete
      expect(mockReportsRepo.save).not.toHaveBeenCalled();
    });

    it("should successfully generate and return the file path", async () => {
      mockJobRunRepo.findOne.mockResolvedValue({
        ...mockJobRun,
        jobConfig: { jobType: JobType.Migrate },
      });
      jest.spyOn(path, "join").mockReturnValue(mockFilePath);

      // ZIP doesn't exist (1st check), CSV doesn't exist (2nd check),
      // ZIP verified present after creation (3rd check)
      jest
        .spyOn(fs.promises, "access")
        .mockRejectedValueOnce(new Error("not found")) // ZIP does not exist
        .mockRejectedValueOnce(new Error("not found")) // CSV does not exist
        .mockResolvedValueOnce(undefined);             // ZIP verified after createZipFile

      mockCsvService.generateCsv.mockResolvedValue(undefined);
      jest.spyOn(service as any, "createZipFile").mockResolvedValue(undefined);
      jest.spyOn(fs.promises, "unlink").mockResolvedValue(undefined);
      jest.spyOn(fs.promises, "readFile").mockResolvedValue(Buffer.from("test data") as any);

      mockReportsRepo.create.mockReturnValue({});
      mockReportsRepo.save.mockResolvedValue({});

      const result = await service.getCocReportByJobRunId(jobRunId);

      expect(result).toBe(mockFilePath);
      // Fresh CSV generation — no resumeCursor (5th arg omitted)
      expect(mockCsvService.generateCsv).toHaveBeenCalledWith(
        mockFilePath,
        jobRunId,
        50000,
        'MIGRATE'
      );
      expect(mockJobRunRepo.update).toHaveBeenCalledWith(
        { id: jobRunId },
        { isReportReady: true }
      );
      expect(mockReportsRepo.create).toHaveBeenCalledWith({
        jobRunId,
        reportData: expect.any(String),
        reportType: ReportType.COC,
      });
      expect(mockReportsRepo.save).toHaveBeenCalled();
    });

    it("should not update isReportReady for CutOver job type", async () => {
      mockJobRunRepo.findOne.mockResolvedValue({
        ...mockJobRun,
        jobConfig: { jobType: JobType.CutOver },
      });
      jest.spyOn(path, "join").mockReturnValue(mockFilePath);
      jest
        .spyOn(fs.promises, "access")
        .mockRejectedValueOnce(new Error("not found")) // CSV does not exist
        .mockResolvedValueOnce(undefined);             // file exists after generation
      mockCsvService.generateCsv.mockResolvedValue(undefined);
      jest.spyOn(service as any, "createZipFile").mockResolvedValue(undefined);
      jest.spyOn(fs.promises, "readFile").mockResolvedValue(Buffer.from("test data") as any);
      mockReportsRepo.create.mockReturnValue({});
      mockReportsRepo.save.mockResolvedValue({});

      await service.getCocReportByJobRunId(jobRunId);

      expect(mockJobRunRepo.update).not.toHaveBeenCalledWith(
        { id: jobRunId },
        { isReportReady: true }
      );
    });

    it("should create zip if CSV exists but zip does not (backfill path)", async () => {
      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      jest.spyOn(path, "join").mockReturnValue(mockFilePath);
      // ZIP doesn't exist (1st check), CSV exists (2nd check),
      // ZIP verified present after creation (3rd check)
      jest
        .spyOn(fs.promises, "access")
        .mockRejectedValueOnce(new Error("not found")) // ZIP does not exist
        .mockResolvedValueOnce(undefined)              // CSV exists
        .mockResolvedValueOnce(undefined);             // ZIP verified after createZipFile

      // Skip complex file-read logic in getResumeCursor — treat as fresh start
      jest.spyOn(service as any, "getResumeCursor").mockResolvedValue(null);

      mockCsvService.generateCsv.mockResolvedValue(undefined);

      const createZipSpy = jest
        .spyOn(service as any, "createZipFile")
        .mockResolvedValue(undefined);

      jest.spyOn(fs.promises, "unlink").mockResolvedValue(undefined);
      jest.spyOn(fs.promises, "readFile").mockResolvedValue(Buffer.from("test data") as any);

      mockReportsRepo.create.mockReturnValue({});
      mockReportsRepo.save.mockResolvedValue({});

      const result = await service.getCocReportByJobRunId(jobRunId);

      expect(createZipSpy).toHaveBeenCalled();
      expect(result).toBe(mockFilePath);
      expect(mockJobRunRepo.update).toHaveBeenCalledWith({ id: jobRunId }, { isReportReady: true });
      expect(mockReportsRepo.save).toHaveBeenCalled();
    });
  });

  describe("getJobSubStatus", () => {
    const jobRunId = "12345";

    it("should return the job sub status", async () => {
      const mockSubStatus = { subStatus: "SOME_STATUS" };
      mockJobRunRepo.findOne.mockResolvedValue(mockSubStatus);

      const result = await service.getJobSubStatus(jobRunId);

      expect(result).toEqual(mockSubStatus);
      expect(mockJobRunRepo.findOne).toHaveBeenCalledWith({
        where: { id: jobRunId },
        select: ["subStatus"],
      });
    });
  });

  describe("fallback Logger (no loggerFactory)", () => {
    it("should use NestJS Logger when loggerFactory is not provided", async () => {
      const moduleWithoutLogger = await Test.createTestingModule({
        providers: [
          JobRunService,
          { provide: getRepositoryToken(JobRunEntity), useValue: mockJobRunRepo },
          { provide: getRepositoryToken(InventoryEntity), useValue: mockInventoryRepo },
          { provide: getRepositoryToken(TaskEntity), useValue: mockTaskRepo },
          { provide: getRepositoryToken(ReportsEntity), useValue: mockReportsRepo },
          { provide: CsvService, useValue: mockCsvService },
          { provide: getRepositoryToken(JobStatsSummaryMvEntity), useValue: mockJobSummaryMvRepo },
          { provide: getRepositoryToken(StorageOverviewSummaryEntity), useValue: mockStorageSummaryMvRepo },
          { provide: ProjectIdCacheService, useValue: { getProjectIdFromCache: jest.fn().mockResolvedValue("project-123") } },
        ],
      }).compile();

      const fallbackService = moduleWithoutLogger.get<JobRunService>(JobRunService);
      expect(fallbackService).toBeDefined();
      expect(fallbackService["logger"]).toBeInstanceOf(Logger);
    });
  });

  describe("getJobStatsId - additional branch coverage", () => {
    const jobId = "12345";

    it("should throw NotFoundException when second findOne (jobRun) returns null", async () => {
      mockJobRunRepo.findOne
        .mockResolvedValueOnce({ isReportReady: false }) // getLatestReportStatus
        .mockResolvedValueOnce(null);                    // jobRun
      mockReportsRepo.findOne.mockResolvedValue(null);

      await expect(service.getJobStatsId(jobId)).rejects.toThrow(NotFoundException);
    });

    it("should save report when jobStatsSummary.jobRunStatus is Completed", async () => {
      const mockJobRun = {
        id: jobId,
        startTime: new Date(),
        status: JobRunStatus.Completed,
        jobConfig: {
          id: "configId",
          jobType: JobType.Discover,
          sourcePath: {
            fileServer: { protocol: "http", config: { configName: "src" } },
            volumePath: "/src",
          },
          destinationPath: {
            fileServer: { protocol: "ftp", config: { configName: "dst" } },
            volumePath: "/dst",
          },
        },
        options: null,
        worker: [],
      };

      mockJobRunRepo.findOne
        .mockResolvedValueOnce({ isReportReady: false })
        .mockResolvedValueOnce(mockJobRun);
      mockReportsRepo.findOne.mockResolvedValue(null);
      mockJobSummaryMvRepo.findOne.mockResolvedValue({
        fileCount: 10,
        directoryCount: 5,
        totalSize: 1024,
        jobRunStatus: JobRunStatus.Completed,
        completed: 10,
        pending: 0,
        errored: 0,
        running: 0,
        lastRefreshed: new Date(),
      });
      mockReportsRepo.create.mockReturnValue({});
      mockReportsRepo.save.mockResolvedValue({});

      const result = await service.getJobStatsId(jobId);

      expect(mockReportsRepo.save).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  describe("getCocReportByJobRunId - error branch coverage", () => {
    const jobRunId = "12345";
    const mockJobRun = { id: jobRunId, jobConfig: { jobType: JobType.Migrate } };
    const mockFilePath = `./reports/${jobRunId}-coc-report.csv`;

    it("should throw NotAcceptableException for invalid zip file path", async () => {
      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      jest.spyOn(path, "join")
        .mockReturnValueOnce("./reports/id-coc-report.csv") // valid csv path
        .mockReturnValueOnce("/invalid/path.zip");           // invalid zip path

      await expect(service.getCocReportByJobRunId(jobRunId)).rejects.toThrow(NotAcceptableException);
    });

    it("should throw when createZipFile fails during backfill", async () => {
      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      jest.spyOn(path, "join").mockReturnValue(mockFilePath);
      // ZIP doesn't exist (1st check), CSV exists (2nd check)
      jest.spyOn(fs.promises, "access")
        .mockRejectedValueOnce(new Error("no zip"))   // ZIP doesn't exist
        .mockResolvedValueOnce(undefined);             // CSV exists
      jest.spyOn(service as any, "getResumeCursor").mockResolvedValue(null);
      mockCsvService.generateCsv.mockResolvedValue(undefined);
      jest.spyOn(service as any, "createZipFile").mockRejectedValue(new Error("zip creation failed"));

      await expect(service.getCocReportByJobRunId(jobRunId)).rejects.toThrow("zip creation failed");
    });

    it("should throw when generateCsv fails", async () => {
      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      jest.spyOn(path, "join").mockReturnValue(mockFilePath);
      jest.spyOn(fs.promises, "access").mockRejectedValue(new Error("not found"));
      mockCsvService.generateCsv.mockRejectedValue(new Error("csv generation failed"));

      await expect(service.getCocReportByJobRunId(jobRunId)).rejects.toThrow("csv generation failed");
    });

    it("should throw when createZipFile fails after CSV generation", async () => {
      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      jest.spyOn(path, "join").mockReturnValue(mockFilePath);
      jest.spyOn(fs.promises, "access").mockRejectedValue(new Error("not found"));
      mockCsvService.generateCsv.mockResolvedValue(undefined);
      jest.spyOn(service as any, "createZipFile").mockRejectedValue(new Error("zip failed"));

      await expect(service.getCocReportByJobRunId(jobRunId)).rejects.toThrow("zip failed");
    });

    it("should throw when readFile fails after generation", async () => {
      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      jest.spyOn(path, "join").mockReturnValue(mockFilePath);
      jest.spyOn(fs.promises, "access")
        .mockRejectedValueOnce(new Error("not found")) // CSV doesn't exist
        .mockRejectedValueOnce(new Error("not found")) // ZIP doesn't exist
        .mockResolvedValueOnce(undefined);              // file exists after generation
      mockCsvService.generateCsv.mockResolvedValue(undefined);
      jest.spyOn(service as any, "createZipFile").mockResolvedValue(undefined);
      jest.spyOn(fs.promises, "readFile").mockRejectedValue(new Error("read failed"));

      await expect(service.getCocReportByJobRunId(jobRunId)).rejects.toThrow("read failed");
    });
  });

  // ─── getResumeCursor (private) ─────────────────────────────────────────────
  describe("getResumeCursor (private)", () => {
    beforeEach(() => {
      jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 100 } as any);
      jest.spyOn(fs.promises, "truncate").mockResolvedValue(undefined);
    });

    it("should return null when file is empty (size === 0)", async () => {
      jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 0 } as any);
      const result = await (service as any).getResumeCursor("any.csv", "/vol", "proj");
      expect(result).toBeNull();
    });

    it("should return null when stat throws", async () => {
      jest.spyOn(fs.promises, "stat").mockRejectedValue(new Error("stat failed"));
      const result = await (service as any).getResumeCursor("any.csv", "/vol", "proj");
      expect(result).toBeNull();
    });

    it("should return null and warn when 'Source Path' column is absent from CSV header", async () => {
      (firstline as jest.MockedFunction<any>).mockResolvedValue('"Other","Columns"');
      const result = await (service as any).getResumeCursor("any.csv", "/vol", "proj");
      expect(result).toBeNull();
    });

    it("should return null when CSV contains only the header row", async () => {
      (firstline as jest.MockedFunction<any>).mockResolvedValue('"Source Path"');
      (readLastLines.read as jest.Mock).mockResolvedValue('"Source Path"\n');
      const result = await (service as any).getResumeCursor("any.csv", "/vol", "proj");
      expect(result).toBeNull();
    });

    it("should return the cursor path stripped of volumePath prefix", async () => {
      (firstline as jest.MockedFunction<any>).mockResolvedValue('"Source Path"');
      (readLastLines.read as jest.Mock).mockResolvedValue('/vol/dir/file.txt\n');
      const result = await (service as any).getResumeCursor("any.csv", "/vol", "proj");
      expect(result).toBe("/dir/file.txt");
    });

    it("should return sourcePath as-is when it does not start with volumePath", async () => {
      (firstline as jest.MockedFunction<any>).mockResolvedValue('"Source Path"');
      (readLastLines.read as jest.Mock).mockResolvedValue('/other/dir/file.txt\n');
      const result = await (service as any).getResumeCursor("any.csv", "/vol", "proj");
      expect(result).toBe("/other/dir/file.txt");
    });

    it("should correctly parse a quoted path containing a comma as the resume cursor", async () => {
      (firstline as jest.MockedFunction<any>).mockResolvedValue('"Source Path","Destination Path"');
      (readLastLines.read as jest.Mock).mockResolvedValue('"/vol/path,with,comma/file.txt","/dest/path"\n');
      const result = await (service as any).getResumeCursor("any.csv", "/vol", "proj");
      expect(result).toBe("/path,with,comma/file.txt");
    });

    it("should truncate partial last line and use the previous complete line", async () => {
      const partialLine = '/vol/dir/partial_row';
      const prevLine = '/vol/dir/file.txt\n';
      jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 200 } as any);
      (firstline as jest.MockedFunction<any>).mockResolvedValue('"Source Path"');
      (readLastLines.read as jest.Mock)
        .mockResolvedValueOnce(partialLine)   // first call: partial (no \n)
        .mockResolvedValueOnce(prevLine);      // second call: after truncation
      const result = await (service as any).getResumeCursor("any.csv", "/vol", "proj");
      expect(fs.promises.truncate).toHaveBeenCalledWith("any.csv", 200 - partialLine.length);
      expect(result).toBe("/dir/file.txt");
    });

    it("should return null when only the header remains after truncating a partial last line", async () => {
      const partialLine = '/vol/dir/partial_row';
      (firstline as jest.MockedFunction<any>).mockResolvedValue('"Source Path"');
      (readLastLines.read as jest.Mock)
        .mockResolvedValueOnce(partialLine)        // first call: partial
        .mockResolvedValueOnce('"Source Path"\n'); // second call: only header left
      const result = await (service as any).getResumeCursor("any.csv", "/vol", "proj");
      expect(result).toBeNull();
    });
  });

  // ─── error logger ?.stack fallback branches ──────────────────────────────────
  describe("getCocReportByJobRunId - error logger fallback (?.stack branches)", () => {
    const jobRunId = "12345";
    const mockJobRun = { id: jobRunId, jobConfig: { jobType: JobType.Migrate } };
    const mockFilePath = `./reports/${jobRunId}-coc-report.csv`;

    it("should log non-Error csvError (no .stack) and rethrow", async () => {
      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      jest.spyOn(path, "join").mockReturnValue(mockFilePath);
      jest.spyOn(fs.promises, "access").mockRejectedValue(new Error("not found"));
      // Plain string rejection — no .stack property → exercises the || fallback at line 312
      mockCsvService.generateCsv.mockRejectedValue("string-csv-error");
      await expect(service.getCocReportByJobRunId(jobRunId)).rejects.toBe("string-csv-error");
    });

    it("should log non-Error zipError (no .stack) and rethrow", async () => {
      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      jest.spyOn(path, "join").mockReturnValue(mockFilePath);
      jest.spyOn(fs.promises, "access").mockRejectedValue(new Error("not found"));
      mockCsvService.generateCsv.mockResolvedValue(undefined);
      jest.spyOn(service as any, "createZipFile").mockRejectedValue("string-zip-error");
      await expect(service.getCocReportByJobRunId(jobRunId)).rejects.toBe("string-zip-error");
    });

    it("should log non-Error readError (no .stack) and rethrow", async () => {
      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      jest.spyOn(path, "join").mockReturnValue(mockFilePath);
      jest.spyOn(fs.promises, "access")
        .mockRejectedValueOnce(new Error("not found")) // ZIP doesn't exist
        .mockRejectedValueOnce(new Error("not found")) // CSV doesn't exist
        .mockResolvedValueOnce(undefined);             // ZIP verified
      mockCsvService.generateCsv.mockResolvedValue(undefined);
      jest.spyOn(service as any, "createZipFile").mockResolvedValue(undefined);
      jest.spyOn(fs.promises, "unlink").mockResolvedValue(undefined);
      jest.spyOn(fs.promises, "readFile").mockRejectedValue("string-read-error");
      await expect(service.getCocReportByJobRunId(jobRunId)).rejects.toBe("string-read-error");
    });
  });

  describe("createZipFile (private)", () => {
    it("should reject when output path escapes reports directory", async () => {
      await expect(
        (service as any).createZipFile(["./reports/file.csv"], "/etc/passwd")
      ).rejects.toThrow("Output path escapes the reports directory");
    });

    it("should reject when source path escapes reports directory", async () => {
      const reportsDir = path.resolve(service.getReportsDirectory);
      const validOutput = path.join(reportsDir, "output.zip");
      await expect(
        (service as any).createZipFile(["/etc/passwd"], validOutput)
      ).rejects.toThrow("Source path escapes the reports directory");
    });

    it("should successfully create a zip file from a valid source file", async () => {
      const tmpDir = os.tmpdir();
      const origEnv = process.env.REPORT_DOWNLOAD_LOCATION;
      process.env.REPORT_DOWNLOAD_LOCATION = tmpDir;

      // Use path.resolve (not path.join) to avoid the path.join spy set by previous tests
      const sourceFile = path.resolve(tmpDir, "test-coc-source.csv");
      const outputZip = path.resolve(tmpDir, "test-coc-output.zip");
      await fs.promises.writeFile(sourceFile, "col1,col2\nval1,val2\n");

      try {
        await expect(
          (service as any).createZipFile([sourceFile], outputZip)
        ).resolves.toBeUndefined();

        const stat = await fs.promises.stat(outputZip);
        expect(stat.size).toBeGreaterThan(0);
      } finally {
        process.env.REPORT_DOWNLOAD_LOCATION = origEnv;
        await fs.promises.unlink(sourceFile).catch(() => {});
        await fs.promises.unlink(outputZip).catch(() => {});
      }
    });
  });
});
