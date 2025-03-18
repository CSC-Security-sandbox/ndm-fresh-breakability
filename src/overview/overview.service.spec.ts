import { Test, TestingModule } from '@nestjs/testing';
import { OverviewService } from './overview.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InventoryEntity } from '../entities/inventory.entity';
import { ProjectEntity } from '../entities/project.entity';
import { JobRunStatus, JobType } from '../constants/enums';

describe('OverviewService', () => {
  let service: OverviewService;
  let mockInventoryRepository;
  let mockProjectRepository;

  const mockProjectData = {
    id: 'project1',
    configs: [
      {
        fileServers: [
          {
            id: 'server1',
            volumes: [
              {
                sourceConfig: [
                  {
                    id: 'job1',
                    jobType: JobType.Discover,
                    jobRuns: [
                      {
                        id: 'run1',
                        status: JobRunStatus.Completed,
                        jobConfigId: 'job1',
                        createdAt: new Date('2024-01-01')
                      }
                    ]
                  },
                  {
                    id: 'job2',
                    jobType: JobType.Migrate,
                    jobRuns: [
                      {
                        id: 'run2',
                        status: JobRunStatus.Completed,
                        jobConfigId: 'job2',
                        createdAt: new Date('2024-01-02')
                      }
                    ]
                  },
                  {
                    id: 'job3',
                    jobType: JobType.CutOver,
                    jobRuns: [
                      {
                        id: 'run3',
                        status: JobRunStatus.Completed,
                        jobConfigId: 'job3',
                        createdAt: new Date('2024-01-03')
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
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
      find: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverviewService,
        {
          provide: getRepositoryToken(InventoryEntity),
          useValue: mockInventoryRepository
        },
        {
          provide: getRepositoryToken(ProjectEntity),
          useValue: mockProjectRepository
        }
      ],
    }).compile();

    service = module.get<OverviewService>(OverviewService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getStorageAndJobsOverview', () => {
    it('should return overview data with all parameters', async () => {
      mockProjectRepository.find.mockResolvedValue([mockProjectData]);

      const result = await service.getStorageAndJobsOverview('project1', 'server1', 'job1');

      expect(result).toEqual({
        storageDetails: {
          totalDiscoveredSize: "1 KB",
          totalMigratedSize: expect.any(String),
          totalFileServers: 1,
          totalPendingSize: expect.any(String),
        },
        jobDetails: {
          totalDiscoverJobs: 1,
          totalMigrateJobs: {
            baseLineJob: 1,
            incrementalJob: 0,
          },
          totalCutoverJobs: 1,
        },
      });
    });

    it('should handle empty project data', async () => {
      mockProjectRepository.find.mockResolvedValue([]);
      mockInventoryRepository.createQueryBuilder = jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([{ totalSize: 0, totalMigratedSize: 0 }])
      }));

      const result = await service.getStorageAndJobsOverview('project1', null, null);

      expect(result).toEqual({
        storageDetails: {
          totalDiscoveredSize: '0 B',
          totalMigratedSize: '0 B',
          totalFileServers: 0,
          totalPendingSize: '0 B'
        },
        jobDetails: {
          totalDiscoverJobs: 0,
          totalMigrateJobs: {
            baseLineJob: 0,
            incrementalJob: 0
          },
          totalCutoverJobs: 0
        }
      });
    });

    it('should handle multiple migrate jobs', async () => {
      const projectWithMultipleMigrations = {
        ...mockProjectData,
        configs: [{
          ...mockProjectData.configs[0],
          fileServers: [{
            ...mockProjectData.configs[0].fileServers[0],
            volumes: [{
              sourceConfig: [
                {
                  id: 'job2',
                  jobType: JobType.Migrate,
                  jobRuns: [
                    { id: 'run2', status: JobRunStatus.Completed },
                    { id: 'run3', status: JobRunStatus.Completed }
                  ]
                }
              ]
            }]
          }]
        }]
      };

      mockProjectRepository.find.mockResolvedValue([projectWithMultipleMigrations]);

      const result = await service.getStorageAndJobsOverview('project1', null, null);

      expect(result.jobDetails.totalMigrateJobs).toEqual({
        baseLineJob: 1,
        incrementalJob: 1
      });
    });
  });


  describe('where clause construction', () => {
    beforeEach(() => {
      mockInventoryRepository.createQueryBuilder = jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([{ totalSize: 0, totalMigratedSize: 0 }])
      }));
    });

    it('should build correct where clause with configId only', async () => {
      mockProjectRepository.find.mockResolvedValue([{
        configs: [],
      }]);

      await service.getStorageAndJobsOverview(null, 'config1', null);
      
      expect(mockProjectRepository.find).toHaveBeenCalledWith({
        where: {
          configs: {
            id: 'config1'
          }
        },
        relations: [
          'configs',
          'configs.fileServers',
          'configs.fileServers.volumes',
          'configs.fileServers.volumes.sourceConfig',
          'configs.fileServers.volumes.sourceConfig.jobRuns'
        ]
      });
    });

    it('should build correct where clause with jobConfigId only', async () => {
      mockProjectRepository.find.mockResolvedValue([{
        configs: [],
      }]);

      await service.getStorageAndJobsOverview(null, null, 'job1');
      
      expect(mockProjectRepository.find).toHaveBeenCalledWith({
        where: {
          configs: {
            fileServers: {
              volumes: {
                sourceConfig: {
                  id: 'job1',
                  jobRuns: {
                    status: JobRunStatus.Completed
                  }
                }
              }
            }
          }
        },
        relations: [
          'configs',
          'configs.fileServers',
          'configs.fileServers.volumes',
          'configs.fileServers.volumes.sourceConfig',
          'configs.fileServers.volumes.sourceConfig.jobRuns'
        ]
      });
    });

    it('should build correct where clause with only projectId', async () => {
      mockProjectRepository.find.mockResolvedValue([{
        configs: [],
      }]);

      await service.getStorageAndJobsOverview('project1', null, null);
      
      expect(mockProjectRepository.find).toHaveBeenCalledWith({
        where: {
          id: 'project1'
        },
        relations: [
          'configs',
          'configs.fileServers',
          'configs.fileServers.volumes',
          'configs.fileServers.volumes.sourceConfig',
          'configs.fileServers.volumes.sourceConfig.jobRuns'
        ]
      });
    });

    it('should build correct where clause with all parameters', async () => {
      mockProjectRepository.find.mockResolvedValue([{
        configs: [{
          fileServers: [{
            volumes: [{
              sourceConfig: [{
                jobType: JobType.Discover,
                jobRuns: [{
                  id: 'run1',
                  status: JobRunStatus.Completed,
                  jobConfigId: 'job1',
                  createdAt: new Date()
                }]
              }]
            }]
          }]
        }]
      }]);

      await service.getStorageAndJobsOverview('project1', 'config1', 'job1');
      
      expect(mockProjectRepository.find).toHaveBeenCalledWith({
        where: {
          id: 'project1',
          configs: {
            id: 'config1',
            fileServers: {
              volumes: {
                sourceConfig: {
                  id: 'job1',
                  jobRuns: {
                    status: JobRunStatus.Completed
                  }
                }
              }
            }
          }
        },
        relations: [
          'configs',
          'configs.fileServers',
          'configs.fileServers.volumes',
          'configs.fileServers.volumes.sourceConfig',
          'configs.fileServers.volumes.sourceConfig.jobRuns'
        ]
      });
    });

    it('should handle null parameters', async () => {
      mockProjectRepository.find.mockResolvedValue([{
        configs: [],
      }]);

      await service.getStorageAndJobsOverview(null, null, null);
      
      expect(mockProjectRepository.find).toHaveBeenCalledWith({
        where: {},
        relations: [
          'configs',
          'configs.fileServers',
          'configs.fileServers.volumes',
          'configs.fileServers.volumes.sourceConfig',
          'configs.fileServers.volumes.sourceConfig.jobRuns'
        ]
      });
    });
  });
});


