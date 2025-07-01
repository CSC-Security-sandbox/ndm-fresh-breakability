import { Test, TestingModule } from "@nestjs/testing";
import { JobRunController } from "./job-run.controller";
import { JobRunService } from "./job-run.service";
import { ErrorLogService } from "src/csv/error_log_csv.service";
import { Logger, StreamableFile } from "@nestjs/common";

describe("JobRunController", () => {
  let controller: JobRunController;
  let jobRunService: jest.Mocked<JobRunService>;
  let errorLogService: jest.Mocked<ErrorLogService>;

  const mockResponse = { some: "data" };
  const mockCsvFile = new StreamableFile(Buffer.from("file content"));

  const mockLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobRunController],
      providers: [
        {
          provide: JobRunService,
          useValue: {
            jobRunReportByJobRunId: jest.fn(),
            getJobStatsId: jest.fn(),
            getJobSubStatus: jest.fn(),
            getCocReportByJobRunId: jest.fn(),
          },
        },
        {
          provide: ErrorLogService,
          useValue: {
            createCsvFileForJob: jest.fn(),
            downloadErrorLogCsvFile: jest.fn(),
            isCsvFileReady: jest.fn(),
          },
        },
        {
          provide: Logger,
          useValue: mockLogger,
        },
      ],
    }).compile();

    controller = module.get<JobRunController>(JobRunController);
    jobRunService = module.get(JobRunService);
    errorLogService = module.get(ErrorLogService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getJobReportById", () => {
    it("should return parsed job report", async () => {
      jobRunService.jobRunReportByJobRunId.mockResolvedValue(
        JSON.stringify(mockResponse)
      );
      const result = await controller.getJobReportById("id-1", "JOBS_REPORT");
      expect(result).toEqual(mockResponse);
    });
  });

  describe("generateErrorCsv", () => {
    it("should throw if both jobRunId and jobConfigId are provided", async () => {
      await expect(
        controller.generateErrorCsv("jobRunId", "jobConfigId")
      ).rejects.toThrow("Provide either jobRunId or jobConfigId, not both.");
    });

    // it("should throw if both are missing", async () => {
    //   await expect(
    //     controller.generateErrorCsv(undefined, undefined)
    //   ).rejects.toThrow("jobRunId or jobConfigId is required.");
    // });

    it("should start CSV generation and return success message", async () => {
      const result = await controller.generateErrorCsv("jobRunId", undefined);
      expect(errorLogService.createCsvFileForJob).toHaveBeenCalledWith(
        "jobRunId",
        undefined
      );
      expect(result).toEqual({ message: "CSV generation started" });
    });

    it("should handle error and return error message", async () => {
      const error = new Error("Failing intentionally");
      errorLogService.createCsvFileForJob.mockRejectedValueOnce(error);

      const result = await controller.generateErrorCsv("jobRunId", undefined);

      expect(mockLogger.error).toHaveBeenCalledWith(
        "Error generating CSV:",
        error
      );
      expect(result).toEqual({ error: "Failing intentionally" });
    });
  });

  describe("downloadErrorCsv", () => {
    it("should throw if neither jobRunId nor jobConfigId provided", async () => {
      await expect(
        controller.downloadErrorCsv(undefined, undefined)
      ).rejects.toThrow("Provide jobRunId or jobConfigId.");
    });

    it("should return a streamable file", async () => {
      errorLogService.downloadErrorLogCsvFile.mockResolvedValue(mockCsvFile);
      const result = await controller.downloadErrorCsv("jobRunId", undefined);
      expect(result).toEqual(mockCsvFile);
    });
  });

  describe("isErrorCsvReady", () => {
    it("should return error if no IDs are provided", () => {
      const result = controller.isErrorCsvReady(undefined, undefined);
      expect(result).toEqual({
        error: "Either jobRunId or jobConfigId is required",
      });
    });

    it("should return status if ID is provided", () => {
      errorLogService.isCsvFileReady.mockReturnValue({ ready: true } as any);
      const result = controller.isErrorCsvReady("jobRunId", undefined);
      expect(result).toEqual({ ready: true });
    });
  });

  describe("getJobStatsId", () => {
    it("should return merged job run details with subStatus", async () => {
      const mockStats = { id: "123", status: "complete" };
      const mockSubStatus = { subStatus: "partial" };
      jobRunService.getJobStatsId.mockResolvedValue(mockStats);
      jobRunService.getJobSubStatus.mockResolvedValue(mockSubStatus as any);

      const result = await controller.getJobStatsId("123");
      expect(result.status).toBe("partial");
    });

    it("should keep original status if no subStatus found", async () => {
      const mockStats = { id: "123", status: "complete" };
      jobRunService.getJobStatsId.mockResolvedValue(mockStats);
      jobRunService.getJobSubStatus.mockResolvedValue(undefined);

      const result = await controller.getJobStatsId("123");
      expect(result.status).toBe("complete");
    });
  });

  describe("getCocReportByJobRunId", () => {
    it("should return COC report response", async () => {
      jobRunService.getCocReportByJobRunId.mockResolvedValue(
        mockResponse as any
      );
      const result = await controller.getCocReportByJobRunId("job-1");
      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Fetching COC report for JobRunId: job-1"
      );
      expect(result).toEqual(mockResponse);
    });
  });
});
