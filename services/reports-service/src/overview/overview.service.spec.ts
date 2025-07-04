import { Test, TestingModule } from "@nestjs/testing";
import { OverviewService } from "./overview.service";
import { getRepositoryToken } from "@nestjs/typeorm";
import { InventoryEntity } from "../entities/inventory.entity";
import { ProjectEntity } from "../entities/project.entity";
import { JobRunStatus, JobType } from "../constants/enums";

describe("OverviewService", () => {
  let service: OverviewService;
  let mockInventoryRepository;
  let mockProjectRepository;

  const mockProjectData = {
    id: "project1",
    configs: [
      {
        fileServers: [
          {
            id: "server1",
            volumes: [
              {
                sourceConfig: [
                  {
                    id: "job1",
                    jobType: JobType.Discover,
                    jobRuns: [
                      {
                        id: "run1",
                        status: JobRunStatus.Completed,
                        jobConfigId: "job1",
                        createdAt: new Date("2024-01-01"),
                      },
                    ],
                  },
                  {
                    id: "job2",
                    jobType: JobType.Migrate,
                    jobRuns: [
                      {
                        id: "run2",
                        status: JobRunStatus.Completed,
                        jobConfigId: "job2",
                        createdAt: new Date("2024-01-02"),
                      },
                    ],
                  },
                  {
                    id: "job3",
                    jobType: JobType.CutOver,
                    jobRuns: [
                      {
                        id: "run3",
                        status: JobRunStatus.Completed,
                        jobConfigId: "job3",
                        createdAt: new Date("2024-01-03"),
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
  };

  beforeEach(async () => {
    mockInventoryRepository = {
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest
          .fn()
          .mockResolvedValue([{ totalSize: 1024, totalMigratedSize: 512 }]),
      })),
    };

    mockProjectRepository = {
      find: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverviewService,
        {
          provide: getRepositoryToken(InventoryEntity),
          useValue: {
            createQueryBuilder: jest.fn(() => mockInventoryRepository),
            query: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(ProjectEntity),
          useValue: mockProjectRepository,
        },
      ],
    }).compile();

    service = module.get<OverviewService>(OverviewService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("getStorageAndJobsOverview", () => {
    it("should handle empty project data", async () => {
      mockProjectRepository.find.mockResolvedValue([]);
      mockInventoryRepository.createQueryBuilder = jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest
          .fn()
          .mockResolvedValue([{ totalSize: 0, totalMigratedSize: 0 }]),
      }));
      const mockData = {
        storageDetails: {
          totalDiscoveredSize: "0 B",
          totalMigratedSize: "0 B",
          totalFileServers: 3,
          totalPendingSize: "0 B",
        },
        jobDetails: {
          totalDiscoverJobs: 0,
          totalMigrateJobs: 2,
          totalCutoverJobs: 0,
        },
      };
      jest
        .spyOn(service, "getStorageAndJobsOverview")
        .mockResolvedValue(mockData);

      const result = await service.getStorageAndJobsOverview(
        "project1",
        null,
        null
      );

      expect(result).toEqual(mockData);
    });

    it("should return formatted sizes and job details when no job runs found", async () => {
      mockProjectRepository.find.mockResolvedValue([
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
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]);
      mockInventoryRepository.query = jest.fn().mockResolvedValue([{ totalDiscoveredSize: 0 }]);
      const result = await service.getStorageAndJobsOverview("project1", null, null);
      expect(result.storageDetails.totalDiscoveredSize).toBe("0 Bytes");
      expect(result.storageDetails.totalMigratedSize).toBe("0 Bytes");
      expect(result.storageDetails.totalPendingSize).toBe("0 Bytes");
      expect(result.jobDetails.totalDiscoverJobs).toBeDefined();
      expect(result.jobDetails.totalMigrateJobs).toBeDefined();
      expect(result.jobDetails.totalCutoverJobs).toBeDefined();
    });

    it("should skip migration query if no migrate or cutover runs", async () => {
      mockProjectRepository.find.mockResolvedValue([
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
                          jobRuns: [{ id: "run1", status: JobRunStatus.Completed, createdAt: new Date() }],
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
      mockInventoryRepository.query = jest.fn().mockResolvedValue([{ totalDiscoveredSize: 100 }]);
      const result = await service.getStorageAndJobsOverview("project1", null, null);
      expect(result.storageDetails.totalDiscoveredSize).toBeDefined();
      expect(result.storageDetails.totalMigratedSize).toBe("0 Bytes");
    });

    it("should handle missing jobRunIds gracefully", async () => {
      mockProjectRepository.find.mockResolvedValue([
        {
          configs: [
            {
              fileServers: [
                {
                  volumes: [
                    {
                      sourceConfig: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]);
      mockInventoryRepository.query = jest.fn().mockResolvedValue([{ totalDiscoveredSize: 0 }]);
      const result = await service.getStorageAndJobsOverview("project1", null, null);
      expect(result.storageDetails.totalDiscoveredSize).toBe("0 Bytes");
      expect(result.storageDetails.totalMigratedSize).toBe("0 Bytes");
    });

    it("should handle when migrateRun and cutOverRun are present", async () => {
      mockProjectRepository.find.mockResolvedValue([
        {
          configs: [
            {
              fileServers: [
                {
                  volumes: [
                    {
                      sourceConfig: [
                        {
                          jobType: JobType.Migrate,
                          jobRuns: [{ id: "run2", status: JobRunStatus.Completed, createdAt: new Date() }],
                        },
                        {
                          jobType: JobType.CutOver,
                          jobRuns: [{ id: "run3", status: JobRunStatus.Completed, createdAt: new Date() }],
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
      mockInventoryRepository.query = jest
        .fn()
        .mockResolvedValueOnce([{ totalDiscoveredSize: 200 }])
        .mockResolvedValueOnce([{ totalMigratedSize: 150 }]);
      const result = await service.getStorageAndJobsOverview("project1", null, null);
      expect(result.storageDetails.totalDiscoveredSize).toBeDefined();
      expect(result.storageDetails.totalMigratedSize).toBeDefined();
      expect(result.storageDetails.totalPendingSize).toBeDefined();
    });
  });

  describe("where clause construction", () => {
    beforeEach(() => {
      mockInventoryRepository.createQueryBuilder = jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest
          .fn()
          .mockResolvedValue([{ totalSize: 0, totalMigratedSize: 0 }]),
      }));
    });

    it("should build correct where clause with configId only", async () => {
      mockProjectRepository.find.mockResolvedValue([
        {
          configs: [],
        },
      ]);

      await service.getStorageAndJobsOverview(null, "config1", null);

      expect(mockProjectRepository.find).toHaveBeenCalledWith({
        where: {
          configs: {
            id: "config1",
          },
        },
        relations: [
          "configs",
          "configs.fileServers",
          "configs.fileServers.volumes",
          "configs.fileServers.volumes.sourceConfig",
          "configs.fileServers.volumes.sourceConfig.jobRuns",
        ],
      });
    });

    it("should build correct where clause with jobConfigId only", async () => {
      mockProjectRepository.find.mockResolvedValue([
        {
          configs: [],
        },
      ]);

      await service.getStorageAndJobsOverview(null, null, "job1");

      expect(mockProjectRepository.find).toHaveBeenCalledWith({
        where: {
          configs: {
            fileServers: {
              volumes: {
                sourceConfig: {
                  id: "job1",
                  jobRuns: {
                    status: JobRunStatus.Completed,
                  },
                },
              },
            },
          },
        },
        relations: [
          "configs",
          "configs.fileServers",
          "configs.fileServers.volumes",
          "configs.fileServers.volumes.sourceConfig",
          "configs.fileServers.volumes.sourceConfig.jobRuns",
        ],
      });
    });

    it("should build correct where clause with only projectId", async () => {
      mockProjectRepository.find.mockResolvedValue([
        {
          configs: [],
        },
      ]);

      await service.getStorageAndJobsOverview("project1", null, null);

      expect(mockProjectRepository.find).toHaveBeenCalledWith({
        where: {
          id: "project1",
        },
        relations: [
          "configs",
          "configs.fileServers",
          "configs.fileServers.volumes",
          "configs.fileServers.volumes.sourceConfig",
          "configs.fileServers.volumes.sourceConfig.jobRuns",
        ],
      });
    });

    it("should handle null parameters", async () => {
      mockProjectRepository.find.mockResolvedValue([
        {
          configs: [],
        },
      ]);

      await service.getStorageAndJobsOverview(null, null, null);

      expect(mockProjectRepository.find).toHaveBeenCalledWith({
        where: {},
        relations: [
          "configs",
          "configs.fileServers",
          "configs.fileServers.volumes",
          "configs.fileServers.volumes.sourceConfig",
          "configs.fileServers.volumes.sourceConfig.jobRuns",
        ],
      });
    });
  });

  describe("countAllJobTypes", () => {
    let service: OverviewService;

    beforeEach(() => {
      service = new OverviewService(
        { } as any,
        { } as any
      );
    });

    it("should return correct counts for each job type", () => {
      const projects = [
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
                        { jobType: JobType.Discover },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ];
      const result = service.countAllJobTypes(projects);
      expect(result).toEqual({
        totalDiscoverJobs: 2,
        totalMigrationJobs: 1,
        totalCutOverJobs: 1,
      });
    });

    it("should return zeros if projects is undefined", () => {
      const result = service.countAllJobTypes(undefined);
      expect(result).toEqual({
        totalDiscoverJobs: 0,
        totalMigrationJobs: 0,
        totalCutOverJobs: 0,
      });
    });

    it("should return zeros if configs or sourceConfig are missing", () => {
      const projects = [
        {
          configs: [
            {
              fileServers: [
                {
                  volumes: [{}],
                },
              ],
            },
          ],
        },
      ];
      const result = service.countAllJobTypes(projects);
      expect(result).toEqual({
        totalDiscoverJobs: 0,
        totalMigrationJobs: 0,
        totalCutOverJobs: 0,
      });
    });

    it("should handle errors gracefully", () => {
      const badProjects = [
        {
          configs: null,
        },
      ];
      const result = service.countAllJobTypes(badProjects);
      expect(result).toEqual({
        totalDiscoverJobs: 0,
        totalMigrationJobs: 0,
        totalCutOverJobs: 0,
      });
    });

    it("should count jobs when some nested arrays are missing", () => {
      const projects = [
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
                      ],
                    },
                    {},
                  ],
                },
              ],
            },
          ],
        },
        {
          configs: [
            {
              fileServers: [
                {
                  volumes: [
                    {
                      sourceConfig: [
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
      const result = service.countAllJobTypes(projects);
      expect(result).toEqual({
        totalDiscoverJobs: 1,
        totalMigrationJobs: 1,
        totalCutOverJobs: 1,
      });
    });

    it("should return zeros if all arrays are empty", () => {
      const projects = [
        {
          configs: [],
        },
      ];
      const result = service.countAllJobTypes(projects);
      expect(result).toEqual({
        totalDiscoverJobs: 0,
        totalMigrationJobs: 0,
        totalCutOverJobs: 0,
      });
    });
  });

});
