import { Test, TestingModule } from "@nestjs/testing";
import { OverviewService } from "./overview.service";
import { getRepositoryToken } from "@nestjs/typeorm";
import { InventoryEntity } from "src/entities/inventory.entity";
import { ProjectEntity } from "src/entities/project.entity";
import { JobRunStatus, JobType } from "src/constants/enums";
import { Logger } from "@nestjs/common";

jest.mock("@netapp-cloud-datamigrate/jobs-lib", () => ({
  formatBytes: jest.fn((bytes) => `${bytes} B`),
}));

const mockInventoryRepository = {
  query: jest.fn(),
};
const mockProjectRepository = {
  find: jest.fn(),
};

describe("OverviewService", () => {
  let service: OverviewService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverviewService,
        {
          provide: getRepositoryToken(InventoryEntity),
          useValue: mockInventoryRepository,
        },
        {
          provide: getRepositoryToken(ProjectEntity),
          useValue: mockProjectRepository,
        },
        {
          provide: Logger,
          useValue: { log: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<OverviewService>(OverviewService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("should return overview data with zero values if no projects found", async () => {
    mockProjectRepository.find.mockResolvedValue([]);
    mockInventoryRepository.query.mockResolvedValue([
      { totalDiscoveredSize: 0 },
    ]);
    const result = await service.getStorageAndJobsOverview("pid", "cid", "jid");
    expect(result).toEqual({
      storageDetails: {
        totalDiscoveredSize: "0 B",
        totalMigratedSize: "0 B",
        totalFileServers: 0,
        totalPendingSize: "0 B",
      },
      jobDetails: {
        totalDiscoverJobs: 0,
        totalMigrateJobs: {
          baseLineJob: 0,
          incrementalJob: 0,
        },
        totalCutoverJobs: undefined,
      },
    });
  });

  it("should calculate discovered and migrated sizes", async () => {
    const mockJobRun = {
      id: "run1",
      jobConfigId: "jc1",
      status: JobRunStatus.Completed,
      createdAt: new Date().toISOString(),
    };
    const mockProject = {
      configs: [
        {
          fileServers: [
            {
              volumes: [
                {
                  sourceConfig: [
                    {
                      jobType: JobType.Discover,
                      jobRuns: [mockJobRun],
                    },
                    {
                      jobType: JobType.Migrate,
                      jobRuns: [mockJobRun],
                    },
                    {
                      jobType: JobType.CutOver,
                      jobRuns: [mockJobRun],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    mockProjectRepository.find.mockResolvedValue([mockProject]);
    mockInventoryRepository.query
      .mockResolvedValueOnce([{ totalDiscoveredSize: 1000 }])
      .mockResolvedValueOnce([{ totalMigratedSize: 500 }]);
    const result = await service.getStorageAndJobsOverview("pid", "cid", "jid");
    expect(result.storageDetails.totalDiscoveredSize).toBe("1000 B");
    expect(result.storageDetails.totalMigratedSize).toBe("500 B");
    expect(result.storageDetails.totalPendingSize).toBe("500 B");
    expect(result.storageDetails.totalFileServers).toBe(1);
    expect(result.jobDetails.totalDiscoverJobs).toBe(1);
    expect(result.jobDetails.totalMigrateJobs.baseLineJob).toBe(1);
    expect(result.jobDetails.totalMigrateJobs.incrementalJob).toBe(0);
    expect(result.jobDetails.totalCutoverJobs).toBe(1);
  });

  it("should handle no migrate or cutover runs", async () => {
    const mockJobRun = {
      id: "run1",
      jobConfigId: "jc1",
      status: JobRunStatus.Completed,
      createdAt: new Date().toISOString(),
    };
    const mockProject = {
      configs: [
        {
          fileServers: [
            {
              volumes: [
                {
                  sourceConfig: [
                    {
                      jobType: JobType.Discover,
                      jobRuns: [mockJobRun],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    mockProjectRepository.find.mockResolvedValue([mockProject]);
    mockInventoryRepository.query.mockResolvedValue([
      { totalDiscoveredSize: 2000 },
    ]);
    const result = await service.getStorageAndJobsOverview("pid", "cid", "jid");
    expect(result.storageDetails.totalDiscoveredSize).toBe("2000 B");
    expect(result.storageDetails.totalMigratedSize).toBe("0 B");
    expect(result.storageDetails.totalPendingSize).toBe("2000 B");
    expect(result.jobDetails.totalMigrateJobs.baseLineJob).toBe(0);
    expect(result.jobDetails.totalMigrateJobs.incrementalJob).toBe(0);
    expect(result.jobDetails.totalCutoverJobs).toBe(0);
  });

  it("should handle multiple migrate jobs", async () => {
    const migrateRuns = [
      {
        id: "m1",
        jobConfigId: "jc2",
        status: JobRunStatus.Completed,
        createdAt: new Date().toISOString(),
      },
      {
        id: "m2",
        jobConfigId: "jc2",
        status: JobRunStatus.Completed,
        createdAt: new Date().toISOString(),
      },
    ];
    const mockProject = {
      configs: [
        {
          fileServers: [
            {
              volumes: [
                {
                  sourceConfig: [
                    {
                      jobType: JobType.Migrate,
                      jobRuns: migrateRuns,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    mockProjectRepository.find.mockResolvedValue([mockProject]);
    mockInventoryRepository.query
      .mockResolvedValueOnce([{ totalDiscoveredSize: 3000 }])
      .mockResolvedValueOnce([{ totalMigratedSize: 2500 }]);
    const result = await service.getStorageAndJobsOverview("pid", "cid", "jid");
    expect(result.jobDetails.totalMigrateJobs.baseLineJob).toBe(1);
    expect(result.jobDetails.totalMigrateJobs.incrementalJob).toBe(1);
    expect(result.storageDetails.totalDiscoveredSize).toBe("3000 B");
    expect(result.storageDetails.totalMigratedSize).toBe("2500 B");
    expect(result.storageDetails.totalPendingSize).toBe("500 B");
  });
});
