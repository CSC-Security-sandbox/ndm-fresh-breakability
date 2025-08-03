import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";
import { JobRunService } from "./job-run.service";
import { JobRunEntity } from "src/entities/jobrun.entity";
import { InventoryEntity } from "src/entities/inventory.entity";
import { TaskEntity } from "src/entities/task.entity";
import { ReportsEntity } from "src/entities/reports.entity";
import { JobRunStatus, JobType, ReportType } from "src/constants/enums";
import { CsvService } from "src/csv/csv_export.service";
import * as fs from "fs";
import * as path from "path";
import { LoggerFactory } from "@netapp-cloud-datamigrate/logger-lib";

describe("JobRunService", () => {
  let service: JobRunService;
  let mockJobRunRepo;
  let mockInventoryRepo;
  let mockTaskRepo;
  let mockCsvService;
  let loggerMock: any;

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
    loggerMock = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    };
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

    mockCsvService = {
      generateCsv: jest.fn(),
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
          provide: LoggerFactory,
          useValue: {
            create: jest.fn().mockReturnValue(loggerMock),
          },
        },
      ],
    }).compile();

    service = module.get<JobRunService>(JobRunService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("constructor", () => {
    it("should use fallback logger when LoggerFactory is not provided", async () => {
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
          // Note: No LoggerFactory provided to test fallback
        ],
      }).compile();

      const serviceWithFallback = module.get<JobRunService>(JobRunService);
      expect(serviceWithFallback).toBeDefined();
    });
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

    it("should handle generic errors and throw NotFoundException", async () => {
      const genericError = new Error("Database connection failed");
      mockReportsRepo.findOne.mockRejectedValue(genericError);

      await expect(
        service.jobRunReportByJobRunId(jobRunId, "DISCOVERY")
      ).rejects.toThrow(
        new NotFoundException(`Failed to fetch report for jobRunId: ${jobRunId} and reportType: DISCOVERY`)
      );
    });

    it("should re-throw NotFoundException and NotAcceptableException", async () => {
      const notFoundError = new NotFoundException("Custom not found");
      mockReportsRepo.findOne.mockRejectedValue(notFoundError);

      await expect(
        service.jobRunReportByJobRunId(jobRunId, "DISCOVERY")
      ).rejects.toThrow(notFoundError);
    });
  });

  describe("getJobStatsId", () => {
    const jobId = "12345";

    beforeEach(() => {
      // Reset all mocks before each test
      jest.clearAllMocks();
      mockJobRunRepo.findOne.mockReset();
      mockReportsRepo.findOne.mockReset();
      mockReportsRepo.update.mockReset();
    });

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
        worker: [{ workerId: "worker1" }],
      };

      const mockInventorySummary = [
        { isDirectory: true, counts: "10", totalFileSize: "0" },
        { isDirectory: false, counts: "50", totalFileSize: "1024" },
      ];

      // Setup mocks
      mockJobRunRepo.findOne
        .mockResolvedValueOnce({ isReportReady: true }) // For getLatestReportStatus
        .mockResolvedValueOnce(mockJobRun); // For main job run query
      
      mockReportsRepo.findOne.mockResolvedValue(null); // No existing report
      
      const mockInventoryQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(mockInventorySummary),
      };

      const mockTaskQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };

      mockInventoryRepo.createQueryBuilder.mockReturnValue(mockInventoryQueryBuilder);
      mockTaskRepo.createQueryBuilder.mockReturnValue(mockTaskQueryBuilder);

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
        worker: { workerId: "worker1" },
      };
      const mockGetRawMany = [{ count: "1" }];
      mockInventoryRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(mockGetRawMany),
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
        worker: { workerId: "worker1" },
      };

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      mockReportsRepo.create.mockReturnValue({});
      mockReportsRepo.save.mockResolvedValue({});

      await service.getJobStatsId(jobId);

      expect(mockReportsRepo.create).toHaveBeenCalled();
      expect(mockReportsRepo.save).toHaveBeenCalled();
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

    it("should not update existing report when isReportReady values are the same", async () => {
      const mockJobRun = {
        id: jobId,
        isReportReady: true,
      };

      const existingReport = {
        reportData: JSON.stringify({ isReportReady: true }),
      };

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      mockReportsRepo.findOne.mockResolvedValue(existingReport);

      const result = await service.getJobStatsId(jobId);

      expect(mockReportsRepo.update).not.toHaveBeenCalled();
      expect(result.isReportReady).toBe(true);
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

    it("should throw NotFoundException when job run does not exist in getLatestReportStatus", async () => {
      mockJobRunRepo.findOne.mockResolvedValueOnce(null); // First call for getLatestReportStatus

      await expect(service.getJobStatsId(jobId)).rejects.toThrow(
        new NotFoundException(`Job run not found for id ${jobId}`)
      );
    });

    it("should handle generic errors and throw NotFoundException", async () => {
      const genericError = new Error("Database connection failed");
      mockJobRunRepo.findOne.mockRejectedValue(genericError);

      await expect(service.getJobStatsId(jobId)).rejects.toThrow(
        new NotFoundException(`Failed to fetch job run stats for id: ${jobId}`)
      );
    });

    it("should re-throw NotFoundException and NotAcceptableException", async () => {
      const notFoundError = new NotFoundException("Custom not found");
      mockJobRunRepo.findOne.mockRejectedValue(notFoundError);

      await expect(service.getJobStatsId(jobId)).rejects.toThrow(notFoundError);
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
        worker: { workerId: "worker1" },
      };

      const mockInventorySummary = [
        { isDirectory: true, counts: "10" },
        { isDirectory: false, counts: "50", totalFileSize: "500000" },
      ];

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      mockInventoryRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(mockInventorySummary),
      });

      mockTaskRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
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
        worker: { workerId: "worker1" },
      };

      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      mockInventoryRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      mockTaskRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      const result = await service.getJobStatsId(jobId);

      expect(result.discovery).toBeDefined();
      expect(result.discovery.totalSize).toBe("0");
    });
  });

  describe("getCocReportByJobRunId", () => {
    const jobRunId = "12345";
    const mockJobRun = {
      id: jobRunId,
      jobConfig: {
        jobType: JobType.Migrate,
      },
    };
    const mockFilePath = `./reports/${jobRunId}-coc-report.csv`;

    it("should return the file path if the report already exists", async () => {
      jest.spyOn(path, "join").mockReturnValue(mockFilePath);
      jest.spyOn(fs, "existsSync").mockReturnValue(true);
      jest.spyOn(mockJobRunRepo, "findOne").mockResolvedValue(mockJobRun);

      const result = await service.getCocReportByJobRunId(jobRunId);

      expect(result).toBe(mockFilePath);
      expect(fs.existsSync).toHaveBeenCalledWith(mockFilePath);
    });

    it("should successfully generate and return the file path", async () => {
      // Setup mocks
      mockJobRunRepo.findOne.mockResolvedValue({
        ...mockJobRun,
        jobConfig: { jobType: JobType.Migrate },
      });
      jest.spyOn(path, "join").mockReturnValue(mockFilePath);

      // First existsSync returns false (file doesn't exist yet), second returns true (file was created)
      const existsSyncMock = jest.spyOn(fs, "existsSync");
      existsSyncMock.mockReturnValueOnce(false).mockReturnValueOnce(true);

      // Mock CSV generation
      mockCsvService.generateCsv.mockResolvedValue(undefined);

      // Mock file reading
      const mockBuffer = Buffer.from("test data");
      jest.spyOn(fs, "readFileSync").mockReturnValue(mockBuffer);

      // Mock repository operations
      mockReportsRepo.create.mockReturnValue({});
      mockReportsRepo.save.mockResolvedValue({});

      // Call the method
      const result = await service.getCocReportByJobRunId(jobRunId);

      // Verify the result
      expect(result).toBe(mockFilePath);

      // Verify the mocks were called correctly
      expect(mockCsvService.generateCsv).toHaveBeenCalledWith(
        mockFilePath,
        jobRunId
      );
      expect(mockJobRunRepo.update).toHaveBeenCalledWith(
        { id: jobRunId },
        { isReportReady: true }
      );
      expect(fs.readFileSync).toHaveBeenCalledWith(mockFilePath);
      expect(mockReportsRepo.create).toHaveBeenCalledWith({
        jobRunId,
        reportData: expect.any(String),
        reportType: ReportType.COC,
      });
      expect(mockReportsRepo.save).toHaveBeenCalled();
    });

    it("should throw NotFoundException when job run does not exist", async () => {
      mockJobRunRepo.findOne.mockResolvedValue(null);

      await expect(service.getCocReportByJobRunId(jobRunId)).rejects.toThrow(
        new NotFoundException(`Job Run with id ${jobRunId} not found`)
      );
    });

    it("should throw NotFoundException for Discovery job type", async () => {
      const discoveryJobRun = {
        id: jobRunId,
        jobConfig: {
          jobType: JobType.Discover,
        },
      };
      mockJobRunRepo.findOne.mockResolvedValue(discoveryJobRun);

      await expect(service.getCocReportByJobRunId(jobRunId)).rejects.toThrow(
        new NotFoundException(`Job Run with id ${jobRunId} is not a migration job`)
      );
    });

    it("should not update isReportReady for CutOver job type", async () => {
      const cutoverJobRun = {
        id: jobRunId,
        jobConfig: {
          jobType: JobType.CutOver,
        },
      };
      
      mockJobRunRepo.findOne.mockResolvedValue(cutoverJobRun);
      jest.spyOn(path, "join").mockReturnValue(mockFilePath);
      
      const existsSyncMock = jest.spyOn(fs, "existsSync");
      existsSyncMock.mockReturnValueOnce(false).mockReturnValueOnce(true);
      
      mockCsvService.generateCsv.mockResolvedValue(undefined);
      
      const mockBuffer = Buffer.from("test data");
      jest.spyOn(fs, "readFileSync").mockReturnValue(mockBuffer);
      
      mockReportsRepo.create.mockReturnValue({});
      mockReportsRepo.save.mockResolvedValue({});

      await service.getCocReportByJobRunId(jobRunId);

      // Verify that update was NOT called for CutOver job
      expect(mockJobRunRepo.update).not.toHaveBeenCalled();
    });

    it("should throw NotAcceptableException for invalid file path", async () => {
      const invalidPath = "../../../etc/passwd";
      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      jest.spyOn(path, "join").mockReturnValue(invalidPath);

      await expect(service.getCocReportByJobRunId(jobRunId)).rejects.toThrow(
        new Error(`Invalid file path: ${invalidPath}`)
      );
    });

    it("should throw error when file is not found after CSV generation", async () => {
      mockJobRunRepo.findOne.mockResolvedValue({
        ...mockJobRun,
        jobConfig: { jobType: JobType.Migrate },
      });
      jest.spyOn(path, "join").mockReturnValue(mockFilePath);
      
      const existsSyncMock = jest.spyOn(fs, "existsSync");
      existsSyncMock.mockReturnValueOnce(false).mockReturnValueOnce(false); // File not found after generation
      
      mockCsvService.generateCsv.mockResolvedValue(undefined);

      await expect(service.getCocReportByJobRunId(jobRunId)).rejects.toThrow(
        new NotFoundException(`Failed to generate COC report for jobRunId: ${jobRunId}`)
      );
    });

    it("should handle generic errors and throw NotFoundException", async () => {
      const genericError = new Error("Unexpected error");
      mockJobRunRepo.findOne.mockRejectedValue(genericError);

      await expect(service.getCocReportByJobRunId(jobRunId)).rejects.toThrow(
        new NotFoundException(`Failed to generate COC report for jobRunId: ${jobRunId}`)
      );
    });

    it("should re-throw NotFoundException and NotAcceptableException", async () => {
      const notFoundError = new NotFoundException("Custom not found");
      mockJobRunRepo.findOne.mockRejectedValue(notFoundError);

      await expect(service.getCocReportByJobRunId(jobRunId)).rejects.toThrow(notFoundError);
    });

  });

  describe("getReportsDirectory", () => {
    it("should return the configured report directory", () => {
      process.env.REPORT_DOWNLOAD_LOCATION = "/custom/reports";
      
      const directory = service.getReportsDirectory;
      
      expect(directory).toBe("/custom/reports");
    });

    it("should return default directory when env var is not set", () => {
      delete process.env.REPORT_DOWNLOAD_LOCATION;
      
      const directory = service.getReportsDirectory;
      
      expect(directory).toBe("./reports");
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
});
