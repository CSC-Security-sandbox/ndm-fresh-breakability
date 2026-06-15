import { Test, TestingModule } from "@nestjs/testing";
import { InternalServerErrorException, Logger, NotAcceptableException, NotFoundException } from "@nestjs/common";
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
jest.mock("read-last-lines", () => ({ read: jest.fn() }));

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
      generateListCsv: jest.fn().mockResolvedValue(undefined),
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

    it("should override cached report stats with MV data when MV has results", async () => {
      const lastRefreshed = new Date("2025-06-01T10:00:00Z");
      mockJobRunRepo.findOne.mockResolvedValueOnce({
        id: jobId,
        isReportReady: true,
        endTime: lastRefreshed,
        jobStats: {
          fileCount: "99",
          directories: "9",
          totalSize: "8192",
          newlyCopiedCount: "0",
          modifiedCount: "0",
          deletedCount: "0",
        },
      });
      const existingReport = {
        reportData: JSON.stringify({
          isReportReady: true,
          migrate: { fileCount: "0", directories: "0", totalSize: "0" },
        }),
      };
      mockReportsRepo.findOne.mockResolvedValue(existingReport);
      mockJobSummaryMvRepo.findOne.mockResolvedValue({
        fileCount: "99",
        directoryCount: "9",
        totalSize: "8192",
        newlyCopiedCount: "0",
        recopiedCount: "0",
        deletedCount: "0",
        lastRefreshed,
      });

      const result = await service.getJobStatsId(jobId);

      expect(result.migrate.fileCount).toBe("99");
      expect(result.migrate.directories).toBe("9");
      expect(result.lastRefreshed).toEqual(lastRefreshed);
    });

    it("should use MV stats in fresh-build path when MV has results", async () => {
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
        .mockResolvedValueOnce({ id: jobId, isReportReady: false, endTime })
        .mockResolvedValueOnce(mockFullJobRun);
      mockReportsRepo.findOne.mockResolvedValue(null);
      mockJobSummaryMvRepo.findOne.mockResolvedValue({
        fileCount: "77",
        directoryCount: "7",
        totalSize: "4096",
        newlyCopiedCount: "0",
        recopiedCount: "0",
        deletedCount: "0",
        lastRefreshed: null,
      });
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
          sourceDirectoryPath: "/src/dir",
          destinationDirectoryPath: "/dest/dir",
          sourcePath: {
            fileServer: {
              protocol: "SMB",
              config: { configName: "sourceServer" },
            },
            volumePath: "/source",
          },
          destinationPath: {
            fileServer: {
              protocol: "SMB",
              config: { configName: "destServer" },
            },
            volumePath: "/destination",
          },
        },
        options: {
          preserveAccessTime: true,
          preservePermissions: true,
          excludeOlderThan: new Date("2025-01-01T00:00:00Z"),
          excludeFilePatterns: "*.tmp,*.log",
          skipFile: "x-M",
          identityMappingId: "mapping-456",
          smbPermissionInheritanceMode: "INHERIT_PERMS_AS_EXPLICIT",
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
      expect(result.jobOptions.smbPermissionInheritanceMode).toBe(
        "INHERIT_PERMS_AS_EXPLICIT",
      );
    });

    it("should default smbPermissionInheritanceMode to INHERIT_PERMS_AS_IS when null for SMB directory-level run", async () => {
      const mockJobRun = {
        id: jobId,
        startTime: new Date(),
        status: JobRunStatus.Completed,
        jobConfig: {
          id: "configId",
          jobType: JobType.Migrate,
          sourceDirectoryPath: "/src/dir",
          destinationDirectoryPath: "/dest/dir",
          sourcePath: {
            fileServer: { protocol: "SMB", config: { configName: "src" } },
            volumePath: "/source",
          },
          destinationPath: {
            fileServer: { protocol: "SMB", config: { configName: "dest" } },
            volumePath: "/destination",
          },
        },
        options: {
          preserveAccessTime: true,
          preservePermissions: true,
          smbPermissionInheritanceMode: null,
        },
        worker: {},
      };

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      mockReportsRepo.findOne.mockResolvedValue(null);
      mockJobSummaryMvRepo.findOne.mockResolvedValue({
        fileCount: 1,
        directoryCount: 1,
        totalSize: 100,
      });

      const result = await service.getJobStatsId(jobId);

      expect(result.jobOptions.smbPermissionInheritanceMode).toBe(
        "INHERIT_PERMS_AS_IS",
      );
    });

    it("should omit smbPermissionInheritanceMode for NFS job run options", async () => {
      const mockJobRun = {
        id: jobId,
        startTime: new Date(),
        status: JobRunStatus.Completed,
        jobConfig: {
          id: "configId",
          jobType: JobType.Migrate,
          sourceDirectoryPath: "/src/dir",
          sourcePath: {
            fileServer: { protocol: "NFS", config: { configName: "src" } },
            volumePath: "/source",
          },
          destinationPath: {
            fileServer: { protocol: "NFS", config: { configName: "dest" } },
            volumePath: "/destination",
          },
        },
        options: {
          preservePermissions: true,
          smbPermissionInheritanceMode: "INHERIT_PERMS_AS_EXPLICIT",
        },
        worker: {},
      };

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      mockReportsRepo.findOne.mockResolvedValue(null);
      mockJobSummaryMvRepo.findOne.mockResolvedValue({
        fileCount: 1,
        directoryCount: 1,
        totalSize: 100,
      });

      const result = await service.getJobStatsId(jobId);

      expect(result.jobOptions.smbPermissionInheritanceMode).toBeNull();
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

  describe("getJobStatsId - persisted jobStats branches", () => {
    const jobId = "12345";

    const buildMockJobRun = (overrides: any = {}) => ({
      id: jobId,
      startTime: new Date(),
      status: JobRunStatus.Completed,
      jobConfig: {
        id: "configId",
        jobType: JobType.Discover,
        sourcePath: {
          fileServer: { protocol: "http", config: { configName: "sourceServer" } },
          volumePath: "/source",
        },
        destinationPath: {
          fileServer: { protocol: "ftp", config: { configName: "destServer" } },
          volumePath: "/destination",
        },
      },
      options: {
        preserveAccessTime: false,
        excludeOlderThan: null,
        excludeFilePatterns: null,
        skipFile: null,
        identityMappingId: null,
      },
      worker: [],
      ...overrides,
    });

    beforeEach(() => {
      jest.clearAllMocks();
      mockReportsRepo.findOne.mockResolvedValue(null);
    });

    it("should use MV stats for terminal job runs when MV has data", async () => {
      const mockJobRun = buildMockJobRun({ status: JobRunStatus.Completed });

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      mockJobSummaryMvRepo.findOne.mockResolvedValue({
        fileCount: "42",
        directoryCount: "7",
        totalSize: "102400",
        newlyCopiedCount: "0",
        recopiedCount: "0",
        deletedCount: "0",
        lastRefreshed: null,
      });

      const result = await service.getJobStatsId(jobId);

      expect(result.discovery.fileCount).toBe("42");
      expect(result.discovery.directories).toBe("7");
      expect(result.discovery.totalSize).toBe("100 KiB");
    });

    it("should use MV stats for BLOCKED cutover runs (scan finished, review pending)", async () => {
      const mockJobRun = buildMockJobRun({
        status: JobRunStatus.Blocked,
        jobConfig: {
          id: "configId",
          jobType: JobType.CutOver,
          sourcePath: {
            fileServer: { protocol: "http", config: { configName: "sourceServer" } },
            volumePath: "/source",
          },
          destinationPath: {
            fileServer: { protocol: "ftp", config: { configName: "destServer" } },
            volumePath: "/destination",
          },
        },
      });

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      mockJobSummaryMvRepo.findOne.mockResolvedValue({
        fileCount: "100",
        directoryCount: "10",
        totalSize: "2048000",
        newlyCopiedCount: "0",
        recopiedCount: "0",
        deletedCount: "0",
        lastRefreshed: null,
      });

      const result = await service.getJobStatsId(jobId);

      expect(result.cutOver).toBeDefined();
      expect(result.cutOver?.fileCount).toBe("100");
      expect(result.cutOver?.directories).toBe("10");
      expect(result.cutOver?.totalSize).toBe("1.95 MiB");
    });

    it("should fall back to MV stats for non-terminal job runs", async () => {
      const mockJobRun = buildMockJobRun({
        status: JobRunStatus.Running,
        jobStats: null,
      });

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      mockJobSummaryMvRepo.findOne.mockResolvedValue({
        fileCount: 30,
        directoryCount: 6,
        totalSize: 2048,
        jobRunStatus: JobRunStatus.Running,
      });

      const result = await service.getJobStatsId(jobId);

      expect(result.discovery.fileCount).toBe("30");
      expect(result.discovery.directories).toBe("6");
    });

    it("should save report when jobStatsSummary.jobRunStatus is Completed", async () => {
      const mockJobRun = buildMockJobRun({ status: JobRunStatus.Running });

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      mockJobSummaryMvRepo.findOne.mockResolvedValue({
        fileCount: 10,
        directoryCount: 2,
        totalSize: 512,
        jobRunStatus: JobRunStatus.Completed,
        completed: 5,
        pending: 0,
        errored: 0,
        running: 0,
        lastRefreshed: new Date(),
      });
      mockReportsRepo.create.mockReturnValue({});
      mockReportsRepo.save.mockResolvedValue({});

      await service.getJobStatsId(jobId);

      expect(mockReportsRepo.create).toHaveBeenCalledWith({
        jobRunId: jobId,
        reportData: expect.any(String),
        reportType: ReportType.JOB_RUN_STATS,
      });
      expect(mockReportsRepo.save).toHaveBeenCalled();
    });

    it("should include lastRefreshed from jobStatsSummary in saved report path", async () => {
      const lastRefreshed = new Date("2025-09-01T10:00:00Z");
      const existingReport = {
        reportData: JSON.stringify({ isReportReady: true }),
      };

      mockJobRunRepo.findOne.mockResolvedValue({ id: jobId, isReportReady: true });
      mockReportsRepo.findOne.mockResolvedValue(existingReport);
      mockJobSummaryMvRepo.findOne.mockResolvedValue({ lastRefreshed });

      const result = await service.getJobStatsId(jobId);

      expect(result.lastRefreshed).toEqual(lastRefreshed);
    });

    it("should return saved report without lastRefreshed when no jobStatsSummary", async () => {
      const existingReport = {
        reportData: JSON.stringify({ isReportReady: true }),
      };

      mockJobRunRepo.findOne.mockResolvedValue({ id: jobId, isReportReady: true });
      mockReportsRepo.findOne.mockResolvedValue(existingReport);
      mockJobSummaryMvRepo.findOne.mockResolvedValue(null);

      const result = await service.getJobStatsId(jobId);

      expect(result.isReportReady).toBe(true);
      expect(result.lastRefreshed).toBeUndefined();
    });
  });

  describe("getCocReportByJobRunId", () => {
    const cocReportsBaseDir = path.resolve(process.cwd(), "reports");
    const cocReportPathForJob = (id: string) =>
      path.resolve(cocReportsBaseDir, `${id}-coc-report.zip`);
    const cocCsvBundleForJob = (id: string) => ([
      path.resolve(cocReportsBaseDir, `${id}-coc-report/coc-report.csv`),
      path.resolve(cocReportsBaseDir, `${id}-coc-report/deleted-report.csv`),
    ]);


    beforeEach(() => {
      jest
        .spyOn(service as unknown as { ensureWritableReportsBaseDir: () => Promise<string> }, "ensureWritableReportsBaseDir")
        .mockResolvedValue(cocReportsBaseDir);
      jest.spyOn(fs.promises, "mkdir").mockResolvedValue(undefined as any);
      mockCsvService.generateCsv.mockResolvedValue(undefined);
      jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 12345 } as any);
      const { Readable } = require("stream");
      jest.spyOn(fs, "createReadStream").mockImplementation(() =>
        Readable.from([Buffer.from("test-zip-content")])
      );
    });

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
      jest.spyOn(path, "relative").mockReturnValueOnce("..");
      await expect(service.getCocReportByJobRunId("id")).rejects.toThrow(
        NotAcceptableException
      );
      (path.relative as jest.Mock).mockRestore();
    });

    const jobRunId = "12345";
    const mockJobRun = {
      id: jobRunId,
      jobConfig: {
        jobType: JobType.Migrate,
      },
    };
    const expectedCocPath = cocReportPathForJob(jobRunId);

    it("should return the file path if the report already exists and update DB", async () => {
      // ZIP exists — short-circuits immediately, no CSV generation or report saving
      jest.spyOn(service as any, "fileExists").mockResolvedValueOnce(true);
      jest.spyOn(mockJobRunRepo, "findOne").mockResolvedValue(mockJobRun);
      jest.spyOn(service as any, "createZipFile").mockResolvedValue(undefined);
      jest.spyOn(fs.promises, "readFile").mockResolvedValue(Buffer.from("test data") as any);
      jest.spyOn(fs.promises, "rm").mockResolvedValue(undefined as any);
      mockReportsRepo.create.mockReturnValue({});
      mockReportsRepo.save.mockResolvedValue({});

      const result = await service.getCocReportByJobRunId(jobRunId);

      expect(result).toBe(expectedCocPath);
      expect(mockJobRunRepo.update).toHaveBeenCalledWith({ id: jobRunId }, { isReportReady: true });
      // report record is NOT re-saved on short-circuit — ZIP was already complete
      expect(mockReportsRepo.save).not.toHaveBeenCalled();
    });

    it("should successfully generate and return the file path", async () => {
      mockJobRunRepo.findOne.mockResolvedValue({
        ...mockJobRun,
        jobConfig: { jobType: JobType.Migrate },
      });

      // ZIP not found, all CSVs not found (fresh generation)
      jest
        .spyOn(service as any, "fileExists")
        .mockResolvedValueOnce(false)  // ZIP does not exist
        .mockResolvedValueOnce(false)  // coc-report.csv
        .mockResolvedValueOnce(false); // deleted-report.csv
      // ZIP verified present after creation
      jest.spyOn(fs.promises, "access").mockResolvedValue(undefined);

      jest.spyOn(service as any, "createZipFile").mockResolvedValue(undefined);
      jest.spyOn(fs.promises, "rm").mockResolvedValue(undefined as any);
      jest.spyOn(fs.promises, "readFile").mockResolvedValue(Buffer.from("test data") as any);

      mockReportsRepo.create.mockReturnValue({});
      mockReportsRepo.save.mockResolvedValue({});

      const result = await service.getCocReportByJobRunId(jobRunId);

      expect(result).toBe(expectedCocPath);

      // All CSVs generated via unified per-file loop (excluded/skipped temporarily disabled)
      expect(mockCsvService.generateCsv).toHaveBeenCalledTimes(1);
      expect(mockCsvService.generateListCsv).toHaveBeenCalledTimes(1);
      expect(mockCsvService.generateCsv).toHaveBeenCalledWith(
        expect.stringContaining("coc-report.csv"), jobRunId, 50000, JobType.Migrate, null,
      );
      expect(mockJobRunRepo.update).toHaveBeenCalledWith(
        { id: jobRunId },
        { isReportReady: true }
      );
      expect(fs.promises.stat).toHaveBeenCalledWith(expectedCocPath);
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
      jest
        .spyOn(service as any, "fileExists")
        .mockResolvedValueOnce(false)  // ZIP
        .mockResolvedValue(false);     // all CSV files
      jest.spyOn(fs.promises, "access").mockResolvedValue(undefined);
      jest.spyOn(service as any, "createZipFile").mockResolvedValue(undefined);
      jest.spyOn(fs.promises, "readFile").mockResolvedValue(Buffer.from("test data") as any);
      jest.spyOn(fs.promises, "rm").mockResolvedValue(undefined as any);
      mockReportsRepo.create.mockReturnValue({});
      mockReportsRepo.save.mockResolvedValue({});

      await service.getCocReportByJobRunId(jobRunId);

      expect(mockJobRunRepo.update).not.toHaveBeenCalledWith(
        { id: jobRunId },
        { isReportReady: true }
      );
    });

    it("should create zip from generated csv bundle", async () => {
      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      jest
        .spyOn(service as any, "fileExists")
        .mockResolvedValueOnce(false)  // ZIP
        .mockResolvedValue(false);     // all CSV files

      const createZipSpy = jest
        .spyOn(service as any, "createZipFile")
        .mockResolvedValue(undefined);

      jest.spyOn(fs.promises, "access").mockResolvedValue(undefined);
      jest.spyOn(fs.promises, "rm").mockResolvedValue(undefined);
      jest.spyOn(fs.promises, "readFile").mockResolvedValue(Buffer.from("test data") as any);

      mockReportsRepo.create.mockReturnValue({});
      mockReportsRepo.save.mockResolvedValue({});

      const result = await service.getCocReportByJobRunId(jobRunId);

      const bundlePaths = cocCsvBundleForJob(jobRunId);
      expect(createZipSpy).toHaveBeenCalledWith(bundlePaths, expectedCocPath);
      expect(result).toBe(expectedCocPath);
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
    const mockBase = path.resolve(process.cwd(), "reports");
    const mockZipPath = path.resolve(mockBase, `${jobRunId}-coc-report.zip`);
    const mockBundle = [
      path.resolve(mockBase, `${jobRunId}-coc-report/coc-report.csv`),
      path.resolve(mockBase, `${jobRunId}-coc-report/deleted-report.csv`),
    ];

    beforeEach(() => {
      jest
        .spyOn(service as unknown as { ensureWritableReportsBaseDir: () => Promise<string> }, "ensureWritableReportsBaseDir")
        .mockResolvedValue(mockBase);
    });

    it("should throw NotAcceptableException for invalid zip file path", async () => {
      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      jest.spyOn(path, "relative").mockReturnValueOnce("..");

      await expect(service.getCocReportByJobRunId(jobRunId)).rejects.toThrow(NotAcceptableException);
      (path.relative as jest.Mock).mockRestore();
    });

    it("should throw when createZipFile fails during backfill", async () => {
      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      jest.spyOn(service as any, "fileExists").mockResolvedValue(false);
      jest.spyOn(service as any, "createZipFile").mockRejectedValue(new Error("zip creation failed"));

      await expect(service.getCocReportByJobRunId(jobRunId)).rejects.toThrow("zip creation failed");
    });

    it("should throw when generateCsv fails", async () => {
      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      jest.spyOn(service as any, "fileExists").mockResolvedValue(false);
      mockCsvService.generateCsv.mockRejectedValue(new Error("csv generation failed"));

      await expect(service.getCocReportByJobRunId(jobRunId)).rejects.toThrow("csv generation failed");
    });

    it("should throw when createZipFile fails after CSV generation", async () => {
      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      jest.spyOn(service as any, "fileExists").mockResolvedValue(false);
      mockCsvService.generateCsv.mockResolvedValue(undefined);
      jest.spyOn(service as any, "createZipFile").mockRejectedValue(new Error("zip failed"));

      await expect(service.getCocReportByJobRunId(jobRunId)).rejects.toThrow("zip failed");
    });

    it("should throw when readFile fails after generation", async () => {
      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      jest.spyOn(service as any, "fileExists").mockResolvedValue(false);
      jest.spyOn(service as any, "createZipFile").mockResolvedValue(undefined);
      jest.spyOn(fs.promises, "access").mockResolvedValue(undefined);
      jest.spyOn(fs.promises, "rm").mockResolvedValue(undefined);
      jest.spyOn(fs.promises, "stat").mockRejectedValue(new Error("read failed"));

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
    const mockBase = path.resolve(process.cwd(), "reports");
    const mockJobRun = {
      id: jobRunId,
      jobConfig: { jobType: JobType.Migrate, sourcePath: { volumePath: "/vol" } },
    };
    const mockBundle = [
      path.resolve(mockBase, `${jobRunId}-coc-report/coc-report.csv`),
      path.resolve(mockBase, `${jobRunId}-coc-report/deleted-report.csv`),
    ];

    beforeEach(() => {
      jest
        .spyOn(service as unknown as { ensureWritableReportsBaseDir: () => Promise<string> }, "ensureWritableReportsBaseDir")
        .mockResolvedValue(mockBase);
    });

    it("should log non-Error csvError (no .stack) and rethrow", async () => {
      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      jest
        .spyOn(service as any, "fileExists")
        .mockResolvedValueOnce(false)   // ZIP
        .mockResolvedValueOnce(true);   // first CSV file
      jest.spyOn(service as any, "getResumeCursor").mockResolvedValue("/cursor");
      mockCsvService.generateCsv.mockRejectedValue("string-csv-error");
      await expect(service.getCocReportByJobRunId(jobRunId)).rejects.toBe("string-csv-error");
    });

    it("should log non-Error zipError (no .stack) and rethrow", async () => {
      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      jest
        .spyOn(service as any, "fileExists")
        .mockResolvedValueOnce(false)   // ZIP
        .mockResolvedValue(false);      // all CSV files
      mockCsvService.generateCsv.mockResolvedValue(undefined);
      mockCsvService.generateListCsv.mockResolvedValue(undefined);
      jest.spyOn(service as any, "createZipFile").mockRejectedValue("string-zip-error");
      await expect(service.getCocReportByJobRunId(jobRunId)).rejects.toBe("string-zip-error");
    });

    it("should log non-Error readError (no .stack) and rethrow", async () => {
      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      jest.spyOn(service as any, "fileExists").mockResolvedValue(false);
      jest.spyOn(service as any, "createZipFile").mockResolvedValue(undefined);
      jest.spyOn(fs.promises, "access").mockResolvedValue(undefined);
      jest.spyOn(fs.promises, "rm").mockResolvedValue(undefined);
      jest.spyOn(fs.promises, "stat").mockRejectedValueOnce("string-read-error");
      await expect(service.getCocReportByJobRunId(jobRunId)).rejects.toBe("string-read-error");
    });
  });

  describe("createZipFile (private)", () => {
    it("should reject when source path escapes base directory", async () => {
      await expect(
        (service as any).createZipFile(["./reports/file.csv"], "/etc/passwd")
      ).rejects.toThrow("Source path escapes the reports directory");
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

  describe("fileExists (private)", () => {
    it("should return true when file access succeeds", async () => {
      jest.spyOn(fs.promises, "access").mockResolvedValueOnce(undefined as any);
      await expect((service as any).fileExists("/tmp/exists.zip")).resolves.toBe(true);
    });

    it("should return false when file access fails", async () => {
      jest.spyOn(fs.promises, "access").mockRejectedValueOnce(new Error("not found"));
      await expect((service as any).fileExists("/tmp/missing.zip")).resolves.toBe(false);
    });
  });

  describe("getCocReportByJobRunId - cleanup branches", () => {
    const jobRunId = "cleanup-1";
    const reportsBase = path.resolve(process.cwd(), "reports");
    const bundleDir = path.resolve(reportsBase, `${jobRunId}-coc-report`);
    const bundlePaths = [
      path.resolve(bundleDir, "coc-report.csv"),
      path.resolve(bundleDir, "deleted-report.csv"),
    ];

    beforeEach(() => {
      jest
        .spyOn(service as unknown as { ensureWritableReportsBaseDir: () => Promise<string> }, "ensureWritableReportsBaseDir")
        .mockResolvedValue(reportsBase);
      mockJobRunRepo.findOne.mockResolvedValue({ id: jobRunId, jobConfig: { jobType: JobType.Migrate } });
      jest.spyOn(service as any, "fileExists").mockResolvedValue(false);
      jest.spyOn(fs.promises, "mkdir").mockResolvedValue(undefined as any);
      mockCsvService.generateCsv.mockResolvedValue(undefined);
      mockCsvService.generateListCsv.mockResolvedValue(undefined);
      jest.spyOn(service as any, "createZipFile").mockResolvedValue(undefined);
      jest.spyOn(fs.promises, "access").mockResolvedValue(undefined);
      jest.spyOn(fs.promises, "rm").mockResolvedValue(undefined as any);
      jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 12345 } as any);
      const { Readable } = require("stream");
      jest.spyOn(fs, "createReadStream").mockImplementation(() =>
        Readable.from([Buffer.from("test-zip-content")])
      );
      mockReportsRepo.create.mockReturnValue({});
      mockReportsRepo.save.mockResolvedValue({});
    });

    it("should continue successfully when temporary bundle cleanup fails", async () => {
      jest.spyOn(fs.promises, "rm").mockRejectedValueOnce(new Error("rm failed"));

      const result = await service.getCocReportByJobRunId(jobRunId);
      expect(result).toContain(`${jobRunId}-coc-report.zip`);
    });

    it("should skip cleanup when bundle directory is outside reports base", async () => {
      const originalRelative = path.relative;
      const relativeSpy = jest.spyOn(path, "relative");
      relativeSpy.mockImplementation((from: string, to: string) => {
        const value = originalRelative(from, to);
        if (String(to).includes(`${jobRunId}-coc-report`) && !String(to).endsWith('.zip')) {
          return '..';
        }
        return value;
      });

      await expect(service.getCocReportByJobRunId(jobRunId)).rejects.toThrow(NotAcceptableException);

      relativeSpy.mockRestore();
    });
  });

  describe("getJobStatsId - snapshot override behavior", () => {
    it("should override cached report stats with MV data when MV is available", async () => {
      const jobId = "override-1";
      const lastRefreshed = new Date("2025-06-01T12:00:00Z");
      mockJobRunRepo.findOne.mockResolvedValueOnce({
        id: jobId,
        isReportReady: true,
        endTime: lastRefreshed,
        jobStats: {
          fileCount: "11",
          directories: "2",
          totalSize: "2048",
          newlyCopiedCount: "3",
          modifiedCount: "4",
          deletedCount: "6",
        },
      });
      mockReportsRepo.findOne.mockResolvedValueOnce({
        reportData: JSON.stringify({
          isReportReady: true,
          migrate: { fileCount: "0", directories: "0", totalSize: "0 B" },
        }),
      });
      mockJobSummaryMvRepo.findOne.mockResolvedValueOnce({
        fileCount: "11",
        directoryCount: "2",
        totalSize: "2048",
        newlyCopiedCount: "3",
        recopiedCount: "4",
        deletedCount: "6",
        lastRefreshed,
      });

      const result = await service.getJobStatsId(jobId);

      expect(result.migrate.fileCount).toBe("11");
      expect(result.migrate.directories).toBe("2");
      expect(result.migrate.totalSize).toBe("2 KiB");
      expect(result.migrate.modifiedCount).toBe("4");
      expect(result.lastRefreshed).toEqual(lastRefreshed);
    });
  });

  // ─── persisted jobStats snapshot — fresh build path ──────────────────────
  describe("getJobStatsId - persisted jobStats in fresh build path", () => {
    const jobId = "snapshot-fresh-1";

    beforeEach(() => {
      mockReportsRepo.findOne.mockResolvedValue(null);
      mockReportsRepo.create.mockReturnValue({});
      mockReportsRepo.save.mockResolvedValue({});
    });

    it("should use persisted jobStats snapshot for terminal job run (isTerminal && jobRun.jobStats branch)", async () => {
      const endTime = new Date("2025-07-01T09:00:00Z");
      const jobStats = {
        fileCount: "55",
        directories: "8",
        totalSize: "4096",
        newlyCopiedCount: "12",
        modifiedCount: "3",
        deletedCount: "1",
      };
      const mockFullJobRun = {
        id: jobId,
        startTime: new Date(),
        endTime,
        status: JobRunStatus.Completed,
        isReportReady: false,
        jobStats,
        jobConfig: {
          id: "configId",
          jobType: JobType.Migrate,
          sourcePath: {
            fileServer: { protocol: "NFS", config: { configName: "src" } },
            volumePath: "/src",
          },
          destinationPath: {
            fileServer: { protocol: "NFS", config: { configName: "dst" } },
            volumePath: "/dst",
          },
        },
        options: null,
        worker: [],
      };

      mockJobRunRepo.findOne
        .mockResolvedValueOnce({ id: jobId, isReportReady: false, endTime, jobStats })
        .mockResolvedValueOnce(mockFullJobRun);
      mockJobSummaryMvRepo.findOne.mockResolvedValue({
        fileCount: "0",
        directoryCount: "0",
        totalSize: "0",
        jobRunStatus: null,
        lastRefreshed: new Date("2025-07-01T08:00:00Z"),
      });

      const result = await service.getJobStatsId(jobId);

      expect(result.migrate.fileCount).toBe("55");
      expect(result.migrate.directories).toBe("8");
      expect(result.migrate.newlyCopiedCount).toBe("12");
      expect(result.migrate.modifiedCount).toBe("3");
      expect(result.migrate.deletedCount).toBe("1");
      // hasValidSnapshot=true + endTime != null → use endTime as lastRefreshed
      expect(result.lastRefreshed).toEqual(endTime);
    });

    it("should use MV lastRefreshed when snapshot exists but endTime is null (fresh path)", async () => {
      const mvLastRefreshed = new Date("2025-07-01T08:00:00Z");
      const jobStats = {
        fileCount: "20",
        directories: "3",
        totalSize: "1024",
        newlyCopiedCount: "0",
        modifiedCount: "0",
        deletedCount: "0",
      };
      const mockFullJobRun = {
        id: jobId,
        startTime: new Date(),
        endTime: null,
        status: JobRunStatus.Completed,
        isReportReady: false,
        jobStats,
        jobConfig: {
          id: "configId",
          jobType: JobType.Discover,
          sourcePath: {
            fileServer: { protocol: "NFS", config: { configName: "src" } },
            volumePath: "/src",
          },
          destinationPath: {
            fileServer: { protocol: "NFS", config: { configName: "dst" } },
            volumePath: "/dst",
          },
        },
        options: null,
        worker: [],
      };

      mockJobRunRepo.findOne
        .mockResolvedValueOnce({ id: jobId, isReportReady: false, endTime: null, jobStats })
        .mockResolvedValueOnce(mockFullJobRun);
      mockJobSummaryMvRepo.findOne.mockResolvedValue({
        fileCount: "0",
        directoryCount: "0",
        totalSize: "0",
        jobRunStatus: null,
        lastRefreshed: mvLastRefreshed,
      });

      const result = await service.getJobStatsId(jobId);

      // hasValidSnapshot=true but endTime=null → ternary false branch → MV lastRefreshed
      expect(result.lastRefreshed).toEqual(mvLastRefreshed);
      expect(result.discovery.fileCount).toBe("20");
    });
  });

  // ─── cached path — snapshot override branches ─────────────────────────────
  describe("getJobStatsId - cached path snapshot override branches", () => {
    const jobId = "cached-snap-1";

    beforeEach(() => {
      mockReportsRepo.create.mockReturnValue({});
      mockReportsRepo.save.mockResolvedValue({});
    });

    it("should override cached discovery stats with jobStats snapshot", async () => {
      const endTime = new Date("2025-06-02T10:00:00Z");
      const jobStats = {
        fileCount: "33",
        directories: "6",
        totalSize: "2048",
        newlyCopiedCount: "5",
        modifiedCount: "2",
        deletedCount: "1",
      };
      mockJobRunRepo.findOne.mockResolvedValue({ id: jobId, isReportReady: true, endTime, jobStats });
      mockReportsRepo.findOne.mockResolvedValue({
        reportData: JSON.stringify({
          isReportReady: true,
          discovery: { fileCount: "0", directories: "0", totalSize: "0 B" },
        }),
      });
      mockJobSummaryMvRepo.findOne.mockResolvedValue({ lastRefreshed: new Date("2025-06-01") });

      const result = await service.getJobStatsId(jobId);

      expect(result.discovery.fileCount).toBe("33");
      expect(result.discovery.directories).toBe("6");
    });

    it("should override cached cutOver stats with jobStats snapshot", async () => {
      const endTime = new Date("2025-06-02T10:00:00Z");
      const jobStats = {
        fileCount: "77",
        directories: "9",
        totalSize: "8192",
        newlyCopiedCount: "10",
        modifiedCount: "5",
        deletedCount: "2",
      };
      mockJobRunRepo.findOne.mockResolvedValue({ id: jobId, isReportReady: true, endTime, jobStats });
      mockReportsRepo.findOne.mockResolvedValue({
        reportData: JSON.stringify({
          isReportReady: true,
          cutOver: { fileCount: "0", directories: "0", totalSize: "0 B" },
        }),
      });
      mockJobSummaryMvRepo.findOne.mockResolvedValue({ lastRefreshed: new Date("2025-06-01") });

      const result = await service.getJobStatsId(jobId);

      expect(result.cutOver.fileCount).toBe("77");
      expect(result.cutOver.directories).toBe("9");
    });

    it("should use MV lastRefreshed in cached path when snapshot exists but endTime is null", async () => {
      const mvLastRefreshed = new Date("2025-06-01T10:00:00Z");
      const jobStats = {
        fileCount: "20",
        directories: "3",
        totalSize: "1024",
        newlyCopiedCount: "0",
        modifiedCount: "0",
        deletedCount: "0",
      };
      mockJobRunRepo.findOne.mockResolvedValue({ id: jobId, isReportReady: true, endTime: null, jobStats });
      mockReportsRepo.findOne.mockResolvedValue({
        reportData: JSON.stringify({
          isReportReady: true,
          migrate: { fileCount: "0", directories: "0", totalSize: "0 B" },
        }),
      });
      mockJobSummaryMvRepo.findOne.mockResolvedValue({ lastRefreshed: mvLastRefreshed });

      const result = await service.getJobStatsId(jobId);

      // endTime=null → ternary false branch → jobStatsSummary.lastRefreshed
      expect(result.lastRefreshed).toEqual(mvLastRefreshed);
    });
  });

  // ─── resolveJobOptionsSmbPermissionInheritanceMode: both dirs empty ────────
  describe("resolveJobOptionsSmbPermissionInheritanceMode - both directories empty", () => {
    const jobId = "smb-dirs-empty-1";

    beforeEach(() => {
      mockReportsRepo.findOne.mockResolvedValue(null);
      mockReportsRepo.create.mockReturnValue({});
      mockReportsRepo.save.mockResolvedValue({});
    });

    it("should return null when preservePermissions is true, protocol is SMB, but both directories are empty", async () => {
      mockJobRunRepo.findOne.mockResolvedValue({
        id: jobId,
        startTime: new Date(),
        status: JobRunStatus.Completed,
        jobConfig: {
          id: "configId",
          jobType: JobType.Migrate,
          sourceDirectoryPath: "   ",  // whitespace-only → trim → ""
          destinationDirectoryPath: "", // empty
          sourcePath: {
            fileServer: { protocol: "SMB", config: { configName: "src" } },
            volumePath: "/source",
          },
          destinationPath: {
            fileServer: { protocol: "SMB", config: { configName: "dest" } },
            volumePath: "/destination",
          },
        },
        options: {
          preservePermissions: true,
          smbPermissionInheritanceMode: "INHERIT_PERMS_AS_EXPLICIT",
        },
        worker: {},
      });
      mockJobSummaryMvRepo.findOne.mockResolvedValue({ fileCount: 1, directoryCount: 1, totalSize: 100 });

      const result = await service.getJobStatsId(jobId);

      expect(result.jobOptions.smbPermissionInheritanceMode).toBeNull();
    });
  });

  // ─── getCocReportByJobRunId — additional branch coverage ──────────────────
  describe("getCocReportByJobRunId - additional branch coverage", () => {
    const jobRunId = "coc-extra-1";
    const reportsBase = path.resolve(process.cwd(), "reports");

    beforeEach(() => {
      jest
        .spyOn(service as unknown as { ensureWritableReportsBaseDir: () => Promise<string> }, "ensureWritableReportsBaseDir")
        .mockResolvedValue(reportsBase);
      jest.spyOn(fs.promises, "mkdir").mockResolvedValue(undefined as any);
    });

    it("should not update isReportReady when ZIP already exists for CutOver job", async () => {
      mockJobRunRepo.findOne.mockResolvedValue({
        id: jobRunId,
        jobConfig: { jobType: JobType.CutOver },
      });
      jest.spyOn(service as any, "fileExists").mockResolvedValueOnce(true);

      const result = await service.getCocReportByJobRunId(jobRunId);

      const expectedZip = path.resolve(reportsBase, `${jobRunId}-coc-report.zip`);
      expect(result).toBe(expectedZip);
      expect(mockJobRunRepo.update).not.toHaveBeenCalled();
    });

    it("should construct SMB source path prefix when protocol is SMB with sourceDirectoryPath set", async () => {
      mockJobRunRepo.findOne.mockResolvedValue({
        id: jobRunId,
        jobConfig: {
          jobType: JobType.Migrate,
          sourceDirectoryPath: "/share/subdir",
          sourcePath: {
            volumePath: "\\\\server\\vol",
            fileServer: { protocol: "SMB" },
          },
        },
      });
      jest.spyOn(service as any, "fileExists").mockResolvedValue(false);
      jest.spyOn(service as any, "createZipFile").mockResolvedValue(undefined);
      jest.spyOn(fs.promises, "access").mockResolvedValue(undefined);
      jest.spyOn(fs.promises, "rm").mockResolvedValue(undefined as any);
      jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 12345 } as any);
      const { Readable } = require("stream");
      jest.spyOn(fs, "createReadStream").mockImplementation(() =>
        Readable.from([Buffer.from("test-zip-content")])
      );
      mockCsvService.generateCsv.mockResolvedValue(undefined);
      mockReportsRepo.create.mockReturnValue({});
      mockReportsRepo.save.mockResolvedValue({});

      const result = await service.getCocReportByJobRunId(jobRunId);

      const expectedZip = path.resolve(reportsBase, `${jobRunId}-coc-report.zip`);
      expect(result).toBe(expectedZip);
    });
  });

  // ─── getResumeCursor — additional branch coverage ─────────────────────────
  describe("getResumeCursor - additional branch coverage", () => {
    beforeEach(() => {
      jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 100 } as any);
      jest.spyOn(fs.promises, "truncate").mockResolvedValue(undefined);
    });

    it("should return null when the source path cell value is empty string", async () => {
      (firstline as jest.MockedFunction<any>).mockResolvedValue('"Source Path","Other"');
      (readLastLines.read as jest.Mock).mockResolvedValue('"","value"\n');

      const result = await (service as any).getResumeCursor("any.csv", "/vol", "proj");
      expect(result).toBeNull();
    });

    it("should normalize SMB backslash path for list entry when listType is not deleted", async () => {
      const volPath = "\\\\server\\vol";
      const entry = { kind: "list", listType: "excluded", fileName: "excluded-report.csv" };
      (firstline as jest.MockedFunction<any>).mockResolvedValue('"Source Path"');
      (readLastLines.read as jest.Mock).mockResolvedValue(`${volPath}\\dir\\skipped.txt\n`);

      const result = await (service as any).getResumeCursor("any.csv", volPath, "proj", entry);
      expect(result).toBe("/dir/skipped.txt");
    });

    it("should NOT normalize backslash path for list entry when listType is deleted", async () => {
      const volPath = "\\\\server\\vol";
      const entry = { kind: "list", listType: "deleted", fileName: "deleted-report.csv" };
      (firstline as jest.MockedFunction<any>).mockResolvedValue('"Source Path"');
      (readLastLines.read as jest.Mock).mockResolvedValue(`${volPath}\\dir\\deleted.txt\n`);

      const result = await (service as any).getResumeCursor("any.csv", volPath, "proj", entry);
      expect(result).toBe("\\dir\\deleted.txt");
    });
  });

  describe("ensureWritableReportsBaseDir (private)", () => {
    const originalEnv = process.env.REPORT_DOWNLOAD_LOCATION;

    afterEach(() => {
      process.env.REPORT_DOWNLOAD_LOCATION = originalEnv;
      jest.restoreAllMocks();
    });

    it("should use configured REPORT_DOWNLOAD_LOCATION when writable", async () => {
      process.env.REPORT_DOWNLOAD_LOCATION = '/tmp/reports-custom';
      jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined as any);
      jest.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined as any);
      jest.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined as any);

      const dir = await (service as any).ensureWritableReportsBaseDir();
      expect(dir).toContain('/tmp/reports-custom');
    });

    it("should fall back to next candidate when configured directory is not writable", async () => {
      process.env.REPORT_DOWNLOAD_LOCATION = '/tmp/not-writable';
      const mkdirSpy = jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined as any);
      const writeSpy = jest
        .spyOn(fs.promises, 'writeFile')
        .mockRejectedValueOnce(new Error('EACCES'))
        .mockResolvedValueOnce(undefined as any)
        .mockResolvedValue(undefined as any);
      jest.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined as any);

      const dir = await (service as any).ensureWritableReportsBaseDir();
      expect(mkdirSpy).toHaveBeenCalled();
      expect(writeSpy).toHaveBeenCalled();
      expect(dir).toBeDefined();
      expect(dir).not.toContain('/tmp/not-writable');
    });

    it("should throw when no candidate reports directory is writable", async () => {
      process.env.REPORT_DOWNLOAD_LOCATION = '/tmp/not-writable';
      jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined as any);
      jest.spyOn(fs.promises, 'writeFile').mockRejectedValue(new Error('EACCES'));
      jest.spyOn(fs.promises, 'unlink').mockRejectedValue(new Error('EACCES'));

      await expect((service as any).ensureWritableReportsBaseDir()).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });
  });
});
