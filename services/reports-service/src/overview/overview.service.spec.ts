import { OverviewService } from "./overview.service";
import { Repository } from "typeorm";
import { Logger } from "@nestjs/common";
import { JobRunStatus, JobType } from "src/constants/enums";
import { OverviewDTO } from "src/overview/overview.dto";

jest.mock("@netapp-cloud-datamigrate/jobs-lib", () => ({
  formatBytes: jest.fn((bytes) => `${bytes} bytes`),
}));

describe("OverviewService", () => {
  let service: OverviewService;
  let inventoryRepository: Partial<Repository<any>>;
  let projectRepository: Partial<Repository<any>>;
  let logger: Partial<Logger>;

  beforeEach(() => {
    inventoryRepository = {
      query: jest.fn(),
    };
    projectRepository = {
      find: jest.fn(),
    };
    logger = {
      log: jest.fn(),
      error: jest.fn(),
    };
    service = new OverviewService(
      inventoryRepository as any,
      projectRepository as any
    );
    // @ts-ignore
    service.logger = logger as Logger;
  });

  it("should return overview data with correct values", async () => {
    const projectDetails = [
      {
        configs: [
          {
            fileServers: [
              {
                volumes: [
                  {
                    sourceConfig: [
                      {
                        id: "jobConfig1",
                        jobType: JobType.Discover,
                        jobRuns: [
                          {
                            id: "run1",
                            jobConfigId: "jobConfig1",
                            status: JobRunStatus.Completed,
                            createdAt: "2024-01-01T00:00:00Z",
                          },
                        ],
                      },
                      {
                        id: "jobConfig2",
                        jobType: JobType.Migrate,
                        jobRuns: [
                          {
                            id: "run2",
                            jobConfigId: "jobConfig2",
                            status: JobRunStatus.Completed,
                            createdAt: "2024-01-02T00:00:00Z",
                          },
                        ],
                      },
                      {
                        id: "jobConfig3",
                        jobType: JobType.CutOver,
                        jobRuns: [
                          {
                            id: "run3",
                            jobConfigId: "jobConfig3",
                            status: JobRunStatus.Completed,
                            createdAt: "2024-01-03T00:00:00Z",
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    (projectRepository.find as jest.Mock).mockResolvedValue(projectDetails);

    (inventoryRepository.query as jest.Mock)
      .mockResolvedValueOnce([{ totalDiscoveredSize: 1000 }])
      .mockResolvedValueOnce([{ totalMigratedSize: 600 }]);

    const result = await service.getStorageAndJobsOverview(
      "proj1",
      "conf1",
      "jobConfig1"
    );

    expect(result).toEqual({
      storageDetails: {
        totalDiscoveredSize: "1000 bytes",
        totalMigratedSize: "600 bytes",
        totalFileServers: 1,
        totalPendingSize: "400 bytes",
      },
      jobDetails: {
        totalDiscoverJobs: 1,
        totalMigrateJobs: 1,
        totalCutoverJobs: 1,
      },
    });
    expect(projectRepository.find).toHaveBeenCalled();
    expect(inventoryRepository.query).toHaveBeenCalledTimes(2);
  });

  it("should handle no job runs gracefully", async () => {
    (projectRepository.find as jest.Mock).mockResolvedValue([{ configs: [] }]);
    (inventoryRepository.query as jest.Mock).mockResolvedValue([]);

    const result = await service.getStorageAndJobsOverview(
      "proj1",
      "conf1",
      "jobConfig1"
    );

    expect(result).toEqual({
      storageDetails: {
        totalDiscoveredSize: "0 bytes",
        totalMigratedSize: "0 bytes",
        totalFileServers: 0,
        totalPendingSize: "0 bytes",
      },
      jobDetails: {
        totalDiscoverJobs: 0,
        totalMigrateJobs: 0,
        totalCutoverJobs: 0,
      },
    });
  });

  it("should handle missing projectId/configId/jobConfigId", async () => {
    (projectRepository.find as jest.Mock).mockResolvedValue([
      {
        configs: [
          {
            fileServers: [
              {
                volumes: [
                  {
                    sourceConfig: [
                      {
                        id: "jobConfig1",
                        jobType: JobType.Discover,
                        jobRuns: [
                          {
                            id: "run1",
                            jobConfigId: "jobConfig1",
                            status: JobRunStatus.Completed,
                            createdAt: "2024-01-01T00:00:00Z",
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
    (inventoryRepository.query as jest.Mock)
      .mockResolvedValueOnce([{ totalDiscoveredSize: 500 }])
      .mockResolvedValueOnce([{ totalMigratedSize: 0 }]);

    const result = await service.getStorageAndJobsOverview("", "", "");

    expect(result.storageDetails.totalDiscoveredSize).toBe("500 bytes");
    expect(result.storageDetails.totalMigratedSize).toBe("0 bytes");
    expect(result.storageDetails.totalPendingSize).toBe("500 bytes");
    expect(result.jobDetails.totalDiscoverJobs).toBe(1);
  });

  it("should return zero sizes if inventory query returns empty", async () => {
    (projectRepository.find as jest.Mock).mockResolvedValue([
      {
        configs: [
          {
            fileServers: [
              {
                volumes: [
                  {
                    sourceConfig: [
                      {
                        id: "jobConfig1",
                        jobType: JobType.Discover,
                        jobRuns: [
                          {
                            id: "run1",
                            jobConfigId: "jobConfig1",
                            status: JobRunStatus.Completed,
                            createdAt: "2024-01-01T00:00:00Z",
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
    (inventoryRepository.query as jest.Mock)
      .mockResolvedValueOnce([{ totalDiscoveredSize: 0 }])
      .mockResolvedValueOnce([{ totalMigratedSize: 0 }]);

    const result = await service.getStorageAndJobsOverview(
      "proj1",
      "conf1",
      "jobConfig1"
    );

    expect(result.storageDetails.totalDiscoveredSize).toBe("0 bytes");
    expect(result.storageDetails.totalMigratedSize).toBe("0 bytes");
    expect(result.storageDetails.totalPendingSize).toBe("0 bytes");
  });
});
