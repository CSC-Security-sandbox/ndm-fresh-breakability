import { Test, TestingModule } from '@nestjs/testing';
import { OverviewController } from './overview.controller';
import { BadRequestException } from '@nestjs/common';
import { OverviewService } from './overview.service';
import { JwtService } from '@netapp-cloud-datamigrate/auth-lib';

describe("OverviewController", () => {
  let controller: OverviewController;
  let overviewService: OverviewService;

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

  beforeEach(async () => {
    const mockOverviewService = {
      getStorageAndJobsOverview: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OverviewController],
      providers: [{ provide: OverviewService, useValue: mockOverviewService }],
    }).compile();

    controller = module.get<OverviewController>(OverviewController);
    overviewService = module.get<OverviewService>(OverviewService);
  });

  it('should call the service and return the correct response', async () => {
    const mockResponse = {
      storageDetails: {
        totalDiscoveredSize: "2.93 KB",
        totalMigratedSize: "0 B",
        totalFileServers: 1,
        totalPendingSize: "2.93 KB",
      },
      jobDetails: {
        totalDiscoverJobs: 1,
        totalMigrateJobs: 0,
        totalCutoverJobs: 0,
      },
    };
  it("should throw BadRequestException if all query params are missing", async () => {
    await expect(
      controller.getStorageAndJobsOverview(undefined, undefined, undefined)
    ).rejects.toThrow(BadRequestException);
  });

  it("should call service with correct params if projectId is provided", async () => {
    const result = { data: "test" };
    (overviewService.getStorageAndJobsOverview as jest.Mock).mockResolvedValue(
      result
    );

    await expect(
      controller.getStorageAndJobsOverview("proj1", undefined, undefined)
    ).resolves.toEqual(result);

    expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
      "proj1",
      undefined,
      undefined
    );
  });

  it("should call service with correct params if fileServerId is provided", async () => {
    const result = { data: "test2" };
    (overviewService.getStorageAndJobsOverview as jest.Mock).mockResolvedValue(
      result
    );

    await expect(
      controller.getStorageAndJobsOverview(undefined, "fs1", undefined)
    ).resolves.toEqual(result);

    expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
      undefined,
      "fs1",
      undefined
    );
  });

  it("should call service with correct params if jobConfigId is provided", async () => {
    const result = { data: "test3" };
    (overviewService.getStorageAndJobsOverview as jest.Mock).mockResolvedValue(
      result
    );

    await expect(
      controller.getStorageAndJobsOverview(undefined, undefined, "job1")
    ).resolves.toEqual(result);

    expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
      undefined,
      undefined,
      "job1"
    );
  });

  it("should call service with all params if all are provided", async () => {
    const result = { data: "all" };
    (overviewService.getStorageAndJobsOverview as jest.Mock).mockResolvedValue(
      result
    );

    await expect(
      controller.getStorageAndJobsOverview("proj1", "fs1", "job1")
    ).resolves.toEqual(result);

    expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
      "proj1",
      "fs1",
      "job1"
    );
  });

  it("should throw an error for downloadReports (not implemented)", () => {
    expect(() => controller.downloadReports([], "someArg")).toThrowError(
      "Method not implemented."
    );
  });

  it("should throw an error when downloadReports is called with empty array and empty string", () => {
    expect(() => controller.downloadReports([], "")).toThrowError(
      "Method not implemented."
    );
  });

  it("should throw an error when downloadReports is called with undefined array and undefined string", () => {
    expect(() =>
      controller.downloadReports(undefined as any, undefined as any)
    ).toThrowError("Method not implemented.");
  });

  it("should throw an error when downloadReports is called with non-empty array and string", () => {
    expect(() =>
      controller.downloadReports([1, 2, 3] as any, "test")
    ).toThrowError("Method not implemented.");
  });

  // Additional tests for OverviewController

  it("should not throw if only projectId is provided", async () => {
    const result = { data: "onlyProjectId" };
    (overviewService.getStorageAndJobsOverview as jest.Mock).mockResolvedValue(
      result
    );

    await expect(
      controller.getStorageAndJobsOverview("projectId", undefined, undefined)
    ).resolves.toEqual(result);
  });

  it("should not throw if only fileServerId is provided", async () => {
    const result = { data: "onlyFileServerId" };
    (overviewService.getStorageAndJobsOverview as jest.Mock).mockResolvedValue(
      result
    );

    await expect(
      controller.getStorageAndJobsOverview(undefined, "fileServerId", undefined)
    ).resolves.toEqual(result);
  });

  it("should not throw if only jobConfigId is provided", async () => {
    const result = { data: "onlyJobConfigId" };
    (overviewService.getStorageAndJobsOverview as jest.Mock).mockResolvedValue(
      result
    );

    await expect(
      controller.getStorageAndJobsOverview(undefined, undefined, "jobConfigId")
    ).resolves.toEqual(result);
  });

  it("should call service with correct params when multiple params are provided", async () => {
    const result = { data: "multipleParams" };
    (overviewService.getStorageAndJobsOverview as jest.Mock).mockResolvedValue(
      result
    );

    await expect(
      controller.getStorageAndJobsOverview(
        "projectId",
        "fileServerId",
        undefined
      )
    ).resolves.toEqual(result);

    expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
      "projectId",
      "fileServerId",
      undefined
    );
  });
})
