import { Test, TestingModule } from '@nestjs/testing';
import { OverviewService } from './overview.service';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProjectEntity } from 'src/entities/project.entity';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { OverviewDTO } from 'src/overview/overview.dto';
import { JobType } from 'src/constants/enums';

describe('OverviewService', () => {
  let service: OverviewService;
  let projectRepository: Repository<ProjectEntity>;
  let inventoryRepository: Repository<InventoryEntity>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverviewService,
        {
          provide: getRepositoryToken(ProjectEntity),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(InventoryEntity),
          useClass: Repository,
        },
      ],
    }).compile();

    service = module.get<OverviewService>(OverviewService);
    projectRepository = module.get<Repository<ProjectEntity>>(getRepositoryToken(ProjectEntity));
    inventoryRepository = module.get<Repository<InventoryEntity>>(getRepositoryToken(InventoryEntity));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return the correct overview data', async () => {
    const mockProjectDetails = [
      {
        configs: [
          {
            fileServers: [
              {
                volumes: [
                  {
                    jobConfig: [
                      {
                        jobType: JobType.Scan,
                        jobRunDetails: [
                          { id: 'scan1', endTime: new Date('2023-01-01T00:00:00Z') },
                        ],
                      },
                      {
                        jobType: JobType.Migrate,
                        jobRunDetails: [
                          { id: 'migrate1' },
                          { id: 'migrate2' },
                        ],
                      },
                      {
                        jobType: JobType.CutOver,
                        jobRunDetails: [
                          { id: 'cutover1' },
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

    const mockDiscoveredSize = [{ totalSize: 3000 }];
    const mockMigratedSize = [{ totalMigratedSize: 1000 }];

    jest.spyOn(projectRepository, 'find').mockResolvedValue(mockProjectDetails as any);

    const mockInventoryQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValueOnce(mockDiscoveredSize).mockResolvedValueOnce(mockMigratedSize),
    };

    jest.spyOn(inventoryRepository, 'createQueryBuilder').mockReturnValue(mockInventoryQueryBuilder as any);

    const result: OverviewDTO = await service.getStorageAndJobsOverview('project1', 'fileServer1', 'jobConfig1');

    expect(result).toEqual({
      storageDetails: {
        totalDiscoveredSize: "2.93 KB",
        totalMigratedSize: "1000 B",
        totalFileServers: 1,
        totalPendingSize: "1.95 KB",
      },
      jobDetails: {
        totalDiscoverJobs: 1,
        totalMigrateJobs: {
          baseLineJob: 1,
          incrementalJob: 1,
        },
        totalCutoverJobs: 1,
      },
    });

    expect(projectRepository.find).toHaveBeenCalledWith({
      where: expect.any(Object),
      relations: [
        'configs',
        'configs.fileServers',
        'configs.fileServers.volumes',
        'configs.fileServers.volumes.jobConfig',
        'configs.fileServers.volumes.jobConfig.jobRunDetails',
      ],
    });

    expect(mockInventoryQueryBuilder.getRawMany).toHaveBeenCalledTimes(2);
  });

  describe('covertBytes', () => {
    it('should return bytes in B format if less than 1024', () => {
      expect(service.covertBytes(500)).toBe('500 B');
      expect(service.covertBytes(1023)).toBe('1023 B');
    });
    it('should return bytes in KB format if less than 1 MB', () => {
      expect(service.covertBytes(1024)).toBe('1.00 KB');
      expect(service.covertBytes(1048575)).toBe('1024.00 KB');
    });
    it('should return bytes in MB format if less than 1 GB', () => {
      expect(service.covertBytes(1048576)).toBe('1.00 MB');
      expect(service.covertBytes(1073741823)).toBe('1024.00 MB');
    });

    it('should return bytes in GB format if less than 1 TB', () => {
      expect(service.covertBytes(1073741824)).toBe('1024.00 MB');
      //expect(service.covertBytes(1099511627775)).toBe('1024.00 GB');
    });

    it('should return bytes in TB format if less than 1 PB', () => {
      expect(service.covertBytes(1099511627776)).toBe('1.00 GB');
    //  expect(service.covertBytes(1125899906842623)).toBe('1024.00 TB');
    });
  });
});
