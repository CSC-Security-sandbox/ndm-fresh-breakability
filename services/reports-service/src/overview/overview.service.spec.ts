import { Test, TestingModule } from "@nestjs/testing";
import { OverviewService } from "./overview.service";
import { getRepositoryToken } from "@nestjs/typeorm";
import { InventoryEntity } from "src/entities/inventory.entity";
import { ProjectEntity } from "src/entities/project.entity";
import { Repository } from "typeorm";
import { JobRunStatus, JobType } from "src/constants/enums";

const mockInventoryRepo = {
  query: jest.fn(),
};

const mockProjectRepo = {
  find: jest.fn(),
};

describe("OverviewService", () => {
  let service: OverviewService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverviewService,
        {
          provide: getRepositoryToken(InventoryEntity),
          useValue: mockInventoryRepo,
        },
        {
          provide: getRepositoryToken(ProjectEntity),
          useValue: mockProjectRepo,
        },
      ],
    }).compile();

    service = module.get<OverviewService>(OverviewService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getStorageAndJobsOverview", () => {
    it("should return proper overview data with valid project and jobs", async () => {
      const projectId = "123";
      const mockJobRun = {
        id: "job1",
        jobConfigId: "jc1",
        createdAt: new Date(),
        status: JobRunStatus.Completed,
      };
      const mockProjects = [
        {
          configs: [
            {
              id: "config1",
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
        },
      ];

      mockProjectRepo.find.mockResolvedValue(mockProjects);
      mockInventoryRepo.query.mockResolvedValue([
        { totalDiscoveredSize: 5000 },
      ]);

      const result = await service.getStorageAndJobsOverview(
        projectId,
        null,
        null
      );

      expect(mockProjectRepo.find).toHaveBeenCalled();
      expect(mockInventoryRepo.query).toHaveBeenCalled();
      expect(result.jobDetails.totalDiscoverJobs).toBe(1);
      expect(result.jobDetails.totalMigrateJobs).toBe(1);
      expect(result.jobDetails.totalCutoverJobs).toBe(1);
      expect(result.storageDetails.totalDiscoveredSize).toBeDefined();
      expect(result.storageDetails.totalMigratedSize).toBeDefined();
    });

    it("should return zeroed results when no projects are found", async () => {
      mockProjectRepo.find.mockResolvedValue([]);
      const result = await service.getStorageAndJobsOverview("123", null, null);
      expect(result.jobDetails.totalDiscoverJobs).toBe(0);
      expect(result.jobDetails.totalMigrateJobs).toBe(0);
      expect(result.jobDetails.totalCutoverJobs).toBe(0);
    });

    it("should handle no jobRuns gracefully", async () => {
      const projectWithoutJobRuns = [
        {
          configs: [
            {
              id: "config1",
              fileServers: [
                {
                  volumes: [
                    {
                      sourceConfig: [
                        {
                          jobType: JobType.Discover,
                          jobRuns: [],
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

      mockProjectRepo.find.mockResolvedValue(projectWithoutJobRuns);
      mockInventoryRepo.query.mockResolvedValue([{ totalDiscoveredSize: 0 }]);

      const result = await service.getStorageAndJobsOverview("123", null, null);
      expect(result.storageDetails.totalDiscoveredSize).toBe("0 Bytes");
    });

    it("should handle missing job runs and avoid crashing", async () => {
      const mockProjects = [
        {
          configs: [],
        },
      ];
      mockProjectRepo.find.mockResolvedValue(mockProjects);
      mockInventoryRepo.query.mockResolvedValue([{ totalDiscoveredSize: 0 }]);

      const result = await service.getStorageAndJobsOverview("1", null, null);

      expect(result.storageDetails.totalDiscoveredSize).toBeDefined();
      expect(result.jobDetails.totalDiscoverJobs).toBe(0);
    });
  });

  describe("countAllJobTypes", () => {
    it("should count all job types correctly", () => {
      const mockProjects = [
        {
          configs: [
            {
              fileServers: [
                {
                  volumes: [
                    {
                      sourceConfig: [
                        { jobType: JobType.Discover },
                        { jobType: JobType.Migrate },
                        { jobType: JobType.CutOver },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ];

      const result = service.countAllJobTypes(mockProjects);
      expect(result.totalDiscoverJobs).toBe(1);
      expect(result.totalMigrationJobs).toBe(1);
      expect(result.totalCutOverJobs).toBe(1);
    });

    it("should return 0s on error", () => {
      const result = service.countAllJobTypes(null);
      expect(result.totalDiscoverJobs).toBe(0);
    });
  });
});
