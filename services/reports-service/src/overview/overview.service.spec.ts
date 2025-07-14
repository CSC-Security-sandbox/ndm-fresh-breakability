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
    jest.clearAllMocks();
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
        {
          provide: Logger,
          useValue: { log: jest.fn() },
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

    it("should build correct whereClause with all params", async () => {
      const projectId = "p1";
      const configId = "c1";
      const jobConfigId = "jc1";
      mockProjectRepo.find.mockResolvedValue([]);
      mockInventoryRepo.query.mockResolvedValue([{ totalDiscoveredSize: 0 }]);
      await service.getStorageAndJobsOverview(projectId, configId, jobConfigId);
      expect(mockProjectRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: projectId,
            configs: expect.objectContaining({
              id: configId,
              fileServers: expect.objectContaining({
                volumes: expect.objectContaining({
                  sourceConfig: expect.objectContaining({
                    id: jobConfigId,
                    jobRuns: expect.objectContaining({
                      status: JobRunStatus.Completed,
                    }),
                  }),
                }),
              }),
            }),
          }),
          relations: expect.any(Array),
        })
      );
    });

    it("should handle missing configId and jobConfigId", async () => {
      const projectId = "p2";
      mockProjectRepo.find.mockResolvedValue([]);
      mockInventoryRepo.query.mockResolvedValue([{ totalDiscoveredSize: 0 }]);
      await service.getStorageAndJobsOverview(projectId, undefined, undefined);
      expect(mockProjectRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: projectId }),
        })
      );
    });

    it("should handle empty jobRunIds gracefully", async () => {
      const mockProjects = [
        {
          configs: [
            {
              fileServers: [
                {
                  volumes: [
                    {
                      sourceConfig: [
                        {
                          jobType: JobType.Discover,
                          jobRuns: [],
                        },
                        {
                          jobType: JobType.Migrate,
                          jobRuns: [],
                        },
                        {
                          jobType: JobType.CutOver,
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
      mockProjectRepo.find.mockResolvedValue(mockProjects);
      mockInventoryRepo.query.mockResolvedValue([{ totalDiscoveredSize: 0 }]);
      const result = await service.getStorageAndJobsOverview("p3", null, null);
      expect(result.storageDetails.totalDiscoveredSize).toBe("0 Bytes");
      expect(result.storageDetails.totalMigratedSize).toBe("0 Bytes");
      expect(result.storageDetails.totalPendingSize).toBe("0 Bytes");
    });

    it("should calculate pending size correctly", async () => {
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
      mockInventoryRepo.query
        .mockResolvedValueOnce([{ totalDiscoveredSize: 10000 }])
        .mockResolvedValueOnce([{ totalMigratedSize: 4000 }]);
      const result = await service.getStorageAndJobsOverview("p4", null, null);
      expect(result.storageDetails.totalDiscoveredSize).toBeDefined();
      expect(result.storageDetails.totalMigratedSize).toBeDefined();
      expect(result.storageDetails.totalPendingSize).toBeDefined();
    });

    it("should handle when migrateRun and cutOverRun are empty", async () => {
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
        },
      ];
      mockProjectRepo.find.mockResolvedValue(mockProjects);
      mockInventoryRepo.query.mockResolvedValue([
        { totalDiscoveredSize: 5000 },
      ]);
      const result = await service.getStorageAndJobsOverview("p5", null, null);
      expect(result.storageDetails.totalMigratedSize).toBe("0 Bytes");
      expect(result.storageDetails.totalPendingSize).toBeDefined();
    });
  });
});
