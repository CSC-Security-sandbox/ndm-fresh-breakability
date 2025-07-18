import { Test, TestingModule } from "@nestjs/testing";
import { serializeJobRunDetailsResponse } from "./dto/job-rundetails.dto";
import { JobRunController } from "./job-run.controller";
import { JobRunService } from "./job-run.service";
import { Logger } from "@nestjs/common";
import { JwtService } from "@netapp-cloud-datamigrate/auth-lib";

const mockJobRunService = {
  getJobStatsId: jest.fn(),
  jobRunReportByJobRunId: jest.fn(),
  getJobSubStatus: jest.fn(),
};

const mockJwtService = {
  verifyToken: jest.fn().mockResolvedValue({
    user: {
      roles: [
        {
          permissions: ["permission1", "permission2"],
          projects: ["project1"],
        },
      ],
    },
  }),
  configService: {},
  client: jest.fn(),
  logger: jest.fn(),
  getKey: jest.fn(),
};

describe("JobRunController", () => {
  let controller: JobRunController;
  let jobRunService: jest.Mocked<JobRunService>;
  let errorLogService: jest.Mocked<ErrorLogService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobRunController],
      providers: [
        {
          provide: JobRunService,
          useValue: mockJobRunService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        Logger,
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

  describe("generateErrorCsv", () => {});

  describe("downloadErrorCsv", () => {
    it("should return a streamable file", async () => {
      errorLogService.downloadErrorLogCsvFile.mockResolvedValue(mockCsvFile);
      const result = await controller.downloadErrorCsv("jobRunId", undefined);
      expect(result).toEqual(mockCsvFile);
    });
  });

  describe("isErrorCsvReady", () => {
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
