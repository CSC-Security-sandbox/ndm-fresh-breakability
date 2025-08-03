import { Test, TestingModule } from "@nestjs/testing";
import { JobRunController } from "./job-run.controller";
import { JobRunService } from "./job-run.service";
import { ErrorLogService } from "../csv/error_log_csv.service";
import {
  Logger,
  StreamableFile,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  JwtAuthGuard,
  JwtWorkerAuthGuard,
  JwtService,
} from "@netapp-cloud-datamigrate/auth-lib";
import { ConfigService } from "@nestjs/config";
import { serializeJobRunDetailsResponse } from "./dto/job-rundetails.dto";
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

// Mock the serialization function
jest.mock("./dto/job-rundetails.dto", () => ({
  ...jest.requireActual("./dto/job-rundetails.dto"),
  serializeJobRunDetailsResponse: jest.fn((data) => data),
}));

describe("JobRunController", () => {
  let controller: JobRunController;
  let jobRunService: jest.Mocked<JobRunService>;
  let errorLogService: jest.Mocked<ErrorLogService>;
  let logger: jest.Mocked<Logger>;
  let mockLogger: any;

  beforeEach(async () => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
      verbose: jest.fn(),
    };
    const mockJobRunService = {
      jobRunReportByJobRunId: jest.fn(),
      getJobStatsId: jest.fn(),
      getJobSubStatus: jest.fn(),
      getCocReportByJobRunId: jest.fn(),
    };

    const mockErrorLogService = {
      createCsvFileForJob: jest.fn(),
      downloadErrorLogCsvFile: jest.fn(),
      isCsvFileReady: jest.fn(),
    };

    const mockJwtAuthGuard = {
      canActivate: jest.fn().mockReturnValue(true),
    };

    const mockJwtWorkerAuthGuard = {
      canActivate: jest.fn().mockReturnValue(true),
    };

    const mockJwtService = {
      verifyToken: jest.fn(),
      decode: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn().mockReturnValue({
        keycloakBaseUrl: "http://localhost:8080",
        realm: "test",
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobRunController],
      providers: [
        { provide: JobRunService, useValue: mockJobRunService },
        { provide: ErrorLogService, useValue: mockErrorLogService },
        { provide: Logger, useValue: mockLogger },
        { provide: Reflector, useValue: {} },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: LoggerFactory,
          useValue: {
            create: jest.fn().mockReturnValue(mockLogger),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtAuthGuard)
      .overrideGuard(JwtWorkerAuthGuard)
      .useValue(mockJwtWorkerAuthGuard)
      .compile();

    controller = module.get<JobRunController>(JobRunController);
    jobRunService = module.get(JobRunService);
    errorLogService = module.get(ErrorLogService);
    logger = module.get(Logger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getJobReportById", () => {
    it("should return parsed job report when valid JSON response", async () => {
      const mockReport = { jobId: "123", status: "COMPLETED", data: "sample" };
      const jsonString = JSON.stringify(mockReport);
      jobRunService.jobRunReportByJobRunId.mockResolvedValue(jsonString);

      const result = await controller.getJobReportById("job-123", "COC");

      expect(result).toEqual(mockReport);
      expect(jobRunService.jobRunReportByJobRunId).toHaveBeenCalledWith(
        "job-123",
        "COC"
      );
    });

    it("should handle complex nested JSON objects", async () => {
      const complexReport = {
        jobId: "123",
        status: "COMPLETED",
        nested: {
          array: [1, 2, { value: "test" }],
          boolean: true,
          null: null,
        },
      };
      const jsonString = JSON.stringify(complexReport);
      jobRunService.jobRunReportByJobRunId.mockResolvedValue(jsonString);

      const result = await controller.getJobReportById("job-123", "COC");

      expect(result).toEqual(complexReport);
    });

    it("should throw error for invalid JSON response", async () => {
      const invalidJson = "{ invalid json }";
      jobRunService.jobRunReportByJobRunId.mockResolvedValue(invalidJson);

      await expect(
        controller.getJobReportById("job-123", "COC")
      ).rejects.toThrow();
    });

    it("should handle service throwing NotFoundException", async () => {
      jobRunService.jobRunReportByJobRunId.mockRejectedValue(
        new NotFoundException("Report not found")
      );

      await expect(
        controller.getJobReportById("job-123", "COC")
      ).rejects.toThrow(NotFoundException);
    });

    it("should handle empty reportType parameter", async () => {
      const mockReport = { jobId: "123", status: "COMPLETED" };
      const jsonString = JSON.stringify(mockReport);
      jobRunService.jobRunReportByJobRunId.mockResolvedValue(jsonString);

      const result = await controller.getJobReportById("job-123", "");

      expect(result).toEqual(mockReport);
      expect(jobRunService.jobRunReportByJobRunId).toHaveBeenCalledWith(
        "job-123",
        ""
      );
    });

    it("should handle undefined reportType parameter", async () => {
      const mockReport = { jobId: "123", status: "COMPLETED" };
      const jsonString = JSON.stringify(mockReport);
      jobRunService.jobRunReportByJobRunId.mockResolvedValue(jsonString);

      const result = await controller.getJobReportById("job-123", undefined);

      expect(result).toEqual(mockReport);
      expect(jobRunService.jobRunReportByJobRunId).toHaveBeenCalledWith(
        "job-123",
        undefined
      );
    });

    it("should handle special characters in parameters", async () => {
      const mockReport = { jobId: "123", status: "COMPLETED" };
      const jsonString = JSON.stringify(mockReport);
      jobRunService.jobRunReportByJobRunId.mockResolvedValue(jsonString);

      const result = await controller.getJobReportById(
        "job-123!@#",
        "COC-Test"
      );

      expect(result).toEqual(mockReport);
      expect(jobRunService.jobRunReportByJobRunId).toHaveBeenCalledWith(
        "job-123!@#",
        "COC-Test"
      );
    });
  });

  describe("generateErrorCsv", () => {
    it("should generate CSV for job-run type successfully", async () => {
      const mockResponse = {
        success: true,
        message: "CSV generated",
        fileName: "errors.csv",
      };
      errorLogService.createCsvFileForJob.mockResolvedValue(mockResponse);

      const result = await controller.generateErrorCsv("job-123", "job-run");

      expect(result).toEqual(mockResponse);
      expect(errorLogService.createCsvFileForJob).toHaveBeenCalledWith(
        "job-run",
        "job-123"
      );
    });

    it("should generate CSV for job-config type successfully", async () => {
      const mockResponse = {
        success: true,
        message: "CSV generated",
        fileName: "errors.csv",
      };
      errorLogService.createCsvFileForJob.mockResolvedValue(mockResponse);

      const result = await controller.generateErrorCsv(
        "config-456",
        "job-config"
      );

      expect(result).toEqual(mockResponse);
      expect(errorLogService.createCsvFileForJob).toHaveBeenCalledWith(
        "job-config",
        "config-456"
      );
    });

    it("should handle service errors when generating CSV", async () => {
      errorLogService.createCsvFileForJob.mockRejectedValue(
        new Error("Generation failed")
      );

      await expect(
        controller.generateErrorCsv("job-123", "job-run")
      ).rejects.toThrow("Generation failed");
    });

    it("should handle NotFoundException from service", async () => {
      errorLogService.createCsvFileForJob.mockRejectedValue(
        new NotFoundException("Job not found")
      );

      await expect(
        controller.generateErrorCsv("job-123", "job-run")
      ).rejects.toThrow(NotFoundException);
    });

    it("should handle large job ID", async () => {
      const largeJobId = "job-" + "a".repeat(1000);
      const mockResponse = { success: true, message: "CSV generated" };
      errorLogService.createCsvFileForJob.mockResolvedValue(mockResponse);

      const result = await controller.generateErrorCsv(largeJobId, "job-run");

      expect(result).toEqual(mockResponse);
      expect(errorLogService.createCsvFileForJob).toHaveBeenCalledWith(
        "job-run",
        largeJobId
      );
    });

    it("should handle empty response from service", async () => {
      errorLogService.createCsvFileForJob.mockResolvedValue(null);

      const result = await controller.generateErrorCsv("job-123", "job-run");

      expect(result).toBe(null);
    });
  });

  describe("downloadErrorCsv", () => {
    it("should return StreamableFile for job-run type", async () => {
      const mockBuffer = Buffer.from("csv,data\\n1,test");
      const mockStream = new StreamableFile(mockBuffer);
      errorLogService.downloadErrorLogCsvFile.mockResolvedValue(mockStream);

      const result = await controller.downloadErrorCsv("job-123", "job-run");

      expect(result).toBeInstanceOf(StreamableFile);
      expect(errorLogService.downloadErrorLogCsvFile).toHaveBeenCalledWith(
        "job-run",
        "job-123"
      );
    });

    it("should return StreamableFile for job-config type", async () => {
      const mockBuffer = Buffer.from("csv,data\\n1,test");
      const mockStream = new StreamableFile(mockBuffer);
      errorLogService.downloadErrorLogCsvFile.mockResolvedValue(mockStream);

      const result = await controller.downloadErrorCsv(
        "config-456",
        "job-config"
      );

      expect(result).toBeInstanceOf(StreamableFile);
      expect(errorLogService.downloadErrorLogCsvFile).toHaveBeenCalledWith(
        "job-config",
        "config-456"
      );
    });

    it("should handle file not found error", async () => {
      errorLogService.downloadErrorLogCsvFile.mockRejectedValue(
        new NotFoundException("File not found")
      );

      await expect(
        controller.downloadErrorCsv("job-123", "job-run")
      ).rejects.toThrow(NotFoundException);
    });

    it("should handle empty CSV file", async () => {
      const mockBuffer = Buffer.from("");
      const mockStream = new StreamableFile(mockBuffer);
      errorLogService.downloadErrorLogCsvFile.mockResolvedValue(mockStream);

      const result = await controller.downloadErrorCsv("job-123", "job-run");

      expect(result).toBeInstanceOf(StreamableFile);
    });

    it("should handle service errors during download", async () => {
      errorLogService.downloadErrorLogCsvFile.mockRejectedValue(
        new Error("Download failed")
      );

      await expect(
        controller.downloadErrorCsv("job-123", "job-run")
      ).rejects.toThrow("Download failed");
    });

    it("should handle special characters in ID", async () => {
      const specialId = "job-123!@#$%";
      const mockBuffer = Buffer.from("csv,data\\n1,test");
      const mockStream = new StreamableFile(mockBuffer);
      errorLogService.downloadErrorLogCsvFile.mockResolvedValue(mockStream);

      const result = await controller.downloadErrorCsv(specialId, "job-run");

      expect(result).toBeInstanceOf(StreamableFile);
      expect(errorLogService.downloadErrorLogCsvFile).toHaveBeenCalledWith(
        "job-run",
        specialId
      );
    });
  });

  describe("isErrorCsvReady", () => {
    it("should return true when CSV is ready for job-run", async () => {
      errorLogService.isCsvFileReady.mockResolvedValue({
        ready: true,
        processing: false,
      });

      const result = await controller.isErrorCsvReady("job-123", "job-run");

      expect(result).toEqual({ ready: true, processing: false });
      expect(errorLogService.isCsvFileReady).toHaveBeenCalledWith(
        "job-run",
        "job-123"
      );
    });

    it("should return false when CSV is not ready for job-config", async () => {
      errorLogService.isCsvFileReady.mockResolvedValue({
        ready: false,
        processing: true,
      });

      const result = await controller.isErrorCsvReady(
        "config-456",
        "job-config"
      );

      expect(result).toEqual({ ready: false, processing: true });
      expect(errorLogService.isCsvFileReady).toHaveBeenCalledWith(
        "job-config",
        "config-456"
      );
    });

    it("should handle service errors", async () => {
      errorLogService.isCsvFileReady.mockRejectedValue(
        new Error("Service error")
      );

      await expect(
        controller.isErrorCsvReady("job-123", "job-run")
      ).rejects.toThrow("Service error");
    });

    it("should handle null response", async () => {
      errorLogService.isCsvFileReady.mockResolvedValue(null);

      const result = await controller.isErrorCsvReady("job-123", "job-run");

      expect(result).toBe(null);
    });

    it("should handle undefined response", async () => {
      errorLogService.isCsvFileReady.mockResolvedValue(undefined);

      const result = await controller.isErrorCsvReady("job-123", "job-run");

      expect(result).toBe(undefined);
    });

    it("should handle valid type parameters", async () => {
      errorLogService.isCsvFileReady.mockResolvedValue({
        ready: false,
        processing: false,
      });

      const result = await controller.isErrorCsvReady("job-123", "job-run");

      expect(result).toEqual({ ready: false, processing: false });
      expect(errorLogService.isCsvFileReady).toHaveBeenCalledWith(
        "job-run",
        "job-123"
      );
    });
  });

  describe("getJobStatsId", () => {
    it("should return job stats with original status when no subStatus", async () => {
      const mockJobStats = {
        id: "job-123",
        status: "COMPLETED",
        progress: 100,
        startTime: new Date(),
        endTime: new Date(),
      };
      const mockSubStatus = null;

      jobRunService.getJobStatsId.mockResolvedValue(mockJobStats);
      jobRunService.getJobSubStatus.mockResolvedValue(mockSubStatus);

      const result = await controller.getJobStatsId("job-123");

      expect(result.status).toBe("COMPLETED");
      expect(jobRunService.getJobStatsId).toHaveBeenCalledWith("job-123");
      expect(jobRunService.getJobSubStatus).toHaveBeenCalledWith("job-123");
      expect(serializeJobRunDetailsResponse).toHaveBeenCalledWith(mockJobStats);
    });

    it("should update status with subStatus when subStatus exists", async () => {
      const mockJobStats = {
        id: "job-123",
        status: "RUNNING",
        progress: 50,
      };
      const mockSubStatus = {
        id: "job-123",
        subStatus: "PAUSED",
        status: "RUNNING",
        startTime: new Date(),
        endTime: null,
        iterationNumber: 1,
        jobConfigId: "config-123",
      } as any;

      jobRunService.getJobStatsId.mockResolvedValue(mockJobStats);
      jobRunService.getJobSubStatus.mockResolvedValue(mockSubStatus);

      const result = await controller.getJobStatsId("job-123");

      expect(result.status).toBe("PAUSED");
      expect(jobRunService.getJobStatsId).toHaveBeenCalledWith("job-123");
      expect(jobRunService.getJobSubStatus).toHaveBeenCalledWith("job-123");
    });

    it("should handle empty subStatus string", async () => {
      const mockJobStats = {
        id: "job-123",
        status: "FAILED",
        progress: 25,
      };
      const mockSubStatus = {
        id: "job-123",
        subStatus: "",
        status: "FAILED",
        startTime: new Date(),
        endTime: null,
        iterationNumber: 1,
        jobConfigId: "config-123",
      } as any;

      jobRunService.getJobStatsId.mockResolvedValue(mockJobStats);
      jobRunService.getJobSubStatus.mockResolvedValue(mockSubStatus);

      const result = await controller.getJobStatsId("job-123");

      expect(result.status).toBe("FAILED");
    });

    it("should handle null subStatus", async () => {
      const mockJobStats = {
        id: "job-123",
        status: "RUNNING",
        progress: 75,
      };
      const mockSubStatus = {
        id: "job-123",
        subStatus: null,
        status: "RUNNING",
        startTime: new Date(),
        endTime: null,
        iterationNumber: 1,
        jobConfigId: "config-123",
      } as any;

      jobRunService.getJobStatsId.mockResolvedValue(mockJobStats);
      jobRunService.getJobSubStatus.mockResolvedValue(mockSubStatus);

      const result = await controller.getJobStatsId("job-123");

      expect(result.status).toBe("RUNNING");
    });

    it("should handle undefined subStatus", async () => {
      const mockJobStats = {
        id: "job-123",
        status: "RUNNING",
        progress: 75,
      };
      const mockSubStatus = {
        id: "job-123",
        subStatus: undefined,
        status: "RUNNING",
        startTime: new Date(),
        endTime: null,
        iterationNumber: 1,
        jobConfigId: "config-123",
      } as any;

      jobRunService.getJobStatsId.mockResolvedValue(mockJobStats);
      jobRunService.getJobSubStatus.mockResolvedValue(mockSubStatus);

      const result = await controller.getJobStatsId("job-123");

      expect(result.status).toBe("RUNNING");
    });

    it("should handle service errors", async () => {
      jobRunService.getJobStatsId.mockRejectedValue(
        new NotFoundException("Job not found")
      );

      await expect(controller.getJobStatsId("job-123")).rejects.toThrow(
        NotFoundException
      );
    });

    it("should handle subStatus service error gracefully", async () => {
      const mockJobStats = {
        id: "job-123",
        status: "COMPLETED",
        progress: 100,
      };

      jobRunService.getJobStatsId.mockResolvedValue(mockJobStats);
      jobRunService.getJobSubStatus.mockRejectedValue(
        new Error("SubStatus error")
      );

      await expect(controller.getJobStatsId("job-123")).rejects.toThrow(
        "SubStatus error"
      );
    });

    it("should handle undefined jobSubStatus response", async () => {
      const mockJobStats = {
        id: "job-123",
        status: "COMPLETED",
        progress: 100,
      };

      jobRunService.getJobStatsId.mockResolvedValue(mockJobStats);
      jobRunService.getJobSubStatus.mockResolvedValue(undefined);

      const result = await controller.getJobStatsId("job-123");

      expect(result.status).toBe("COMPLETED");
    });

    it("should handle false subStatus", async () => {
      const mockJobStats = {
        id: "job-123",
        status: "COMPLETED",
        progress: 100,
      };
      const mockSubStatus = {
        id: "job-123",
        subStatus: false as any,
        status: "COMPLETED",
        startTime: new Date(),
        endTime: null,
        iterationNumber: 1,
        jobConfigId: "config-123",
      } as any;

      jobRunService.getJobStatsId.mockResolvedValue(mockJobStats);
      jobRunService.getJobSubStatus.mockResolvedValue(mockSubStatus);

      const result = await controller.getJobStatsId("job-123");

      expect(result.status).toBe("COMPLETED");
    });

    it("should handle zero as subStatus", async () => {
      const mockJobStats = {
        id: "job-123",
        status: "COMPLETED",
        progress: 100,
      };
      const mockSubStatus = {
        id: "job-123",
        subStatus: 0 as any,
        status: "COMPLETED",
        startTime: new Date(),
        endTime: null,
        iterationNumber: 1,
        jobConfigId: "config-123",
      } as any;

      jobRunService.getJobStatsId.mockResolvedValue(mockJobStats);
      jobRunService.getJobSubStatus.mockResolvedValue(mockSubStatus);

      const result = await controller.getJobStatsId("job-123");

      expect(result.status).toBe("COMPLETED");
    });
  });

  describe("getCocReportByJobRunId", () => {
    it("should return COC report and log debug message", async () => {
      const mockFilePath = "/reports/job-123-coc-report.csv";
      jobRunService.getCocReportByJobRunId.mockResolvedValue(mockFilePath);

      const result = await controller.getCocReportByJobRunId("job-123");

      expect(result.message).toBe("COC report generation started for JobRunId: job-123");
      expect(jobRunService.getCocReportByJobRunId).toHaveBeenCalledWith(
        "job-123"
      );
    });

    it("should handle empty jobRunId", async () => {
      const mockFilePath = "/reports/-coc-report.csv";
      jobRunService.getCocReportByJobRunId.mockResolvedValue(mockFilePath);

      const result = await controller.getCocReportByJobRunId("");

      expect(result.message).toBe("COC report generation started for JobRunId: ");
      expect(logger.debug).toHaveBeenCalledWith(
        "Fetching COC report for JobRunId: "
      );
    });

    it("should handle undefined jobRunId", async () => {
      const mockFilePath = "/reports/undefined-coc-report.csv";
      jobRunService.getCocReportByJobRunId.mockResolvedValue(mockFilePath);

      const result = await controller.getCocReportByJobRunId(undefined);

      expect(result.message).toBe("COC report generation started for JobRunId: undefined");
      expect(logger.debug).toHaveBeenCalledWith(
        "Fetching COC report for JobRunId: undefined"
      );
    });

    it("should handle special characters in jobRunId", async () => {
      const specialJobRunId = "job-123!@#$%^&*()";
      const mockFilePath = `/reports/${specialJobRunId}-coc-report.csv`;
      jobRunService.getCocReportByJobRunId.mockResolvedValue(mockFilePath);

      const result = await controller.getCocReportByJobRunId(specialJobRunId);

      expect(result.message).toBe("COC report generation started for JobRunId: " + specialJobRunId);
      expect(logger.debug).toHaveBeenCalledWith(
        `Fetching COC report for JobRunId: ${specialJobRunId}`
      );
    });

    it("should handle very long jobRunId", async () => {
      const longJobRunId = "job-" + "a".repeat(1000);
      const mockFilePath = `/reports/${longJobRunId}-coc-report.csv`;
      jobRunService.getCocReportByJobRunId.mockResolvedValue(mockFilePath);

      const result = await controller.getCocReportByJobRunId(longJobRunId);

      expect(result).toBeDefined();
      expect(logger.debug).toHaveBeenCalledWith(
        `Fetching COC report for JobRunId: ${longJobRunId}`
      );
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle concurrent requests to the same endpoint", async () => {
      const mockReport = { data: "concurrent test" };
      const jsonString = JSON.stringify(mockReport);
      jobRunService.jobRunReportByJobRunId.mockResolvedValue(jsonString);

      const promises = Array.from({ length: 5 }, (_, i) =>
        controller.getJobReportById(`job-${i}`, "COC")
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(5);
      results.forEach((result) => expect(result).toEqual(mockReport));
    });

    it("should handle malformed JSON gracefully", async () => {
      const malformedJson = '{"incomplete": "json"';
      jobRunService.jobRunReportByJobRunId.mockResolvedValue(malformedJson);

      await expect(
        controller.getJobReportById("job-123", "COC")
      ).rejects.toThrow();
    });

    it("should handle very large JSON responses", async () => {
      const largeObject = { data: "x".repeat(10000) };
      const jsonString = JSON.stringify(largeObject);
      jobRunService.jobRunReportByJobRunId.mockResolvedValue(jsonString);

      const result = await controller.getJobReportById("job-123", "COC");

      expect(result).toEqual(largeObject);
    });
  });

  describe("Controller Initialization and Dependencies", () => {
    it("should be defined", () => {
      expect(controller).toBeDefined();
    });

    it("should have all required dependencies injected", () => {
      expect(jobRunService).toBeDefined();
      expect(errorLogService).toBeDefined();
      expect(logger).toBeDefined();
    });

    it("should have correct method signatures", () => {
      expect(typeof controller.getJobReportById).toBe("function");
      expect(typeof controller.generateErrorCsv).toBe("function");
      expect(typeof controller.downloadErrorCsv).toBe("function");
      expect(typeof controller.isErrorCsvReady).toBe("function");
      expect(typeof controller.getJobStatsId).toBe("function");
      expect(typeof controller.getCocReportByJobRunId).toBe("function");
    });
  });
});
