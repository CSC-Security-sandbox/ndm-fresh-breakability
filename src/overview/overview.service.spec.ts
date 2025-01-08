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
                jobConfig: [
                  {
                    id: 'job1',
                    jobType: JobType.Discover,
                    jobRunDetails: [
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
                    jobRunDetails: [
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
                    jobRunDetails: [
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
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([{ totalSize: 1024, totalMigratedSize: 512 }])
      }))
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
          totalDiscoveredSize: '1 KB',
          totalMigratedSize: '512 B',
          totalFileServers: 1,
          totalPendingSize: '512 B'
        },
        jobDetails: {
          totalDiscoverJobs: 1,
          totalMigrateJobs: {
            baseLineJob: 1,
            incrementalJob: 0
          },
          totalCutoverJobs: 1
        }
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
              jobConfig: [
                {
                  id: 'job2',
                  jobType: JobType.Migrate,
                  jobRunDetails: [
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

  describe('covertBytes', () => {
    it('should convert bytes to appropriate unit', () => {
      expect(service.covertBytes(1024)).toBe('1 KB');
      expect(service.covertBytes(1024 * 1024)).toBe('1 MB');
      expect(service.covertBytes(1024 * 1024 * 1024)).toBe('1 GB');
      expect(service.covertBytes(500)).toBe('500 B');
    });

    it('should handle decimal values', () => {
      expect(service.covertBytes(1536)).toBe('1.50 KB');
      expect(service.covertBytes(1.5 * 1024 * 1024)).toBe('1.50 MB');
    });

    it('should handle zero bytes', () => {
      expect(service.covertBytes(0)).toBe('0 B');
    });

    it('should handle very large numbers', () => {
      const petabyte = 1024 * 1024 * 1024 * 1024 * 1024;
      expect(service.covertBytes(petabyte)).toBe('1 PB');
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

    it('should build correct where clause with fileServerId only', async () => {
      mockProjectRepository.find.mockResolvedValue([{
        configs: [],
      }]);

      await service.getStorageAndJobsOverview(null, 'server1', null);
      
      expect(mockProjectRepository.find).toHaveBeenCalledWith({
        where: {
          configs: {
            fileServers: {
              id: 'server1'
            }
          }
        },
        relations: [
          'configs',
          'configs.fileServers',
          'configs.fileServers.volumes',
          'configs.fileServers.volumes.jobConfig',
          'configs.fileServers.volumes.jobConfig.jobRunDetails'
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
                jobConfig: {
                  id: 'job1',
                  jobRunDetails: {
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
          'configs.fileServers.volumes.jobConfig',
          'configs.fileServers.volumes.jobConfig.jobRunDetails'
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
          'configs.fileServers.volumes.jobConfig',
          'configs.fileServers.volumes.jobConfig.jobRunDetails'
        ]
      });
    });

    it('should build correct where clause with all parameters', async () => {
      mockProjectRepository.find.mockResolvedValue([{
        configs: [{
          fileServers: [{
            volumes: [{
              jobConfig: [{
                jobType: JobType.Discover,
                jobRunDetails: [{
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

      await service.getStorageAndJobsOverview('project1', 'server1', 'job1');
      
      expect(mockProjectRepository.find).toHaveBeenCalledWith({
        where: {
          id: 'project1',
          configs: {
            fileServers: {
              volumes: {
                jobConfig: {
                  id: 'job1',
                  jobRunDetails: {
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
          'configs.fileServers.volumes.jobConfig',
          'configs.fileServers.volumes.jobConfig.jobRunDetails'
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
          'configs.fileServers.volumes.jobConfig',
          'configs.fileServers.volumes.jobConfig.jobRunDetails'
        ]
      });
    });
  });
});


