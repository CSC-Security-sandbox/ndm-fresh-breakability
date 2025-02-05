import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JobStatus, JobType } from 'src/constants/enums';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { In, Repository } from 'typeorm';

import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobConfigDto } from './dto/jobconfig.dto';
import { JobConfigDiscoverBulk } from './dto/jobdicoverybulk.dto';
import { JobConfigService } from './jobconfig.service';
import { JobListingDTO } from './dto/joblisting.dto';
import { JobOptionsEntity } from 'src/entities/joboptions.entity';

const mockJobEntity = {
  id: 'uuid1',
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: '',
  updatedBy: '',
  jobType: JobType.DISCOVER,
  sourcePathId: '',
  targetPathId: '',
  excludeFilePatterns: '',
  excludeOlderThan: new Date(),
  preserveAccessTime: false,
  futureScheduleAt: null,
  firstRunAt: null,
  status: JobStatus.Active,

};

const mockJobDto = {
  createdBy: '',
  updatedBy: '',
  jobType: JobType.DISCOVER,
  sourcePathId: '',
  status: JobStatus.Active, 
  preserveAccessTime: false, 
  futureScheduleAt: null, 
  targetPathId: '',
  firstRunAt: new Date(),
};

describe('JobConfigService', () => {
  let service: JobConfigService;
  let repo: Repository<JobConfigEntity>;
  let inventoryRepo: Repository<InventoryEntity>;
  let jobOptions: Repository<JobOptionsEntity>

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobConfigService,
        {
          provide: getRepositoryToken(JobConfigEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(JobOptionsEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(InventoryEntity),
          useValue: {
            createQueryBuilder: jest.fn(() => ({
              leftJoin: jest.fn().mockReturnThis(),
              select: jest.fn().mockReturnThis(),
              addSelect: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              orWhere: jest.fn().mockReturnThis(),
              groupBy: jest.fn().mockReturnThis(),
              addGroupBy: jest.fn().mockReturnThis(),
              getRawMany: jest.fn(),
            })),
          },
        }
      ],
    }).compile();

    service = module.get<JobConfigService>(JobConfigService);
    repo = module.get<Repository<JobConfigEntity>>(getRepositoryToken(JobConfigEntity));
    inventoryRepo = module.get<Repository<InventoryEntity>>(getRepositoryToken(InventoryEntity));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });


it('should handle empty sourcePathIds', async () => {
  const bulkDiscovery: JobConfigDiscoverBulk = {

    excludeFilePatterns: '*.tmp',
    preserveAccessTime: true,
    excludeOlderThan: new Date('2022-01-01'),
    firstRunAt: new Date(),
    createdBy: 'user123',
    sourcePathIds: ['qwsd']
  };

  const mockFind = jest.spyOn(repo, 'find').mockResolvedValue([]);
  const mockUpdate = jest.spyOn(repo, 'update').mockResolvedValue(undefined);
  const mockSave = jest.spyOn(repo, 'save').mockResolvedValue(null);

  const result = await service.createBulkDiscovery(bulkDiscovery);

});

it('should default firstRunAt to current date when undefined', async () => {
  // Arrange
  const bulkDiscovery = {
    sourcePathIds: [],
    excludeFilePatterns: '*.tmp',
    preserveAccessTime: true,
    excludeOlderThan: new Date('2022-01-01'),
    futureSchedule: null,
    firstRunAt: null,
    createdBy: 'user123',
  };

  const mockCreate = jest.spyOn(repo, 'create');
  jest.spyOn(repo, 'find').mockResolvedValue([]);
  jest.spyOn(repo, 'save').mockResolvedValue([{ sourcePathId: 'path1' }] as any);

  // Act
  const result = await service.createBulkDiscovery(bulkDiscovery);
});

it('should handle database errors in find method', async () => {
  // Arrange
  const bulkDiscovery = {
    sourcePathIds: [],
    excludeFilePatterns: '*.tmp',
    preserveAccessTime: true,
    excludeOlderThan: new Date('2022-01-01'),
    futureSchedule: null,
    firstRunAt: new Date(),
    createdBy: 'user123',
  };

  jest.spyOn(repo, 'find').mockRejectedValue(new Error('Database error'));

  // Act & Assert
  await expect(service.createBulkDiscovery(bulkDiscovery)).rejects.toThrowError('Database error');
});


  describe('updateJobConfig', () => {
    it('should update a job', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(mockJobEntity as any);
      jest.spyOn(repo, 'save').mockResolvedValue(mockJobEntity as any);

      const result = await service.updateJobConfig('uuid1', mockJobDto);
      expect(result).toEqual(mockJobEntity);
      expect(repo.save).toHaveBeenCalledWith(mockJobEntity);
    });

    it('should throw an error if job not found', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(undefined);

      await expect(service.updateJobConfig('uuid1', mockJobDto)).rejects.toThrowError(
        'Job with id uuid1 not found',
      );
    });
  });

  describe('deleteJobConfig', () => {
    it('should delete a job by id', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(mockJobEntity as any);
      jest.spyOn(repo, 'remove').mockResolvedValue(undefined);

      const result = await service.deleteJobConfig('uuid1');
      expect(result).toEqual({ message: 'Job with id uuid1 has been deleted' });
      expect(repo.remove).toHaveBeenCalledWith(mockJobEntity);
    });

    it('should throw an error if job not found', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(undefined);

      await expect(service.deleteJobConfig('uuid1')).rejects.toThrowError(
        'Job with id uuid1 not found',
      );
    });
  });

  it('should return a payload with job configurations', async () => {
    const projectId = '123';
    const mockJobDetails = [
      {
        jobconfigid: '1',
        jobtype: 'COPY',
        jobconfigstatus: 'ACTIVE',
        sourcepath: '/source/path',
        targetpath: '/target/path',
        sourceprotocol: 'HTTP',
        targetprotocol: 'FTP',
        sourceservername: 'SourceServer',
        targetservername: 'TargetServer',
        futureschedule: '0 0 * * *',
        totalRuns: 5,
        createdat: new Date().toISOString(),
      },
      {
        jobconfigid: '2',
        jobtype: 'DELETE',
        jobconfigstatus: 'INACTIVE',
        sourcepath: '/source/only',
        targetpath: null,
        sourceprotocol: 'HTTPS',
        targetprotocol: null,
        sourceservername: 'SourceServerOnly',
        targetservername: null,
        futureschedule: '0 12 * * *',
        totalRuns: 0,
        createdat: new Date().toISOString(),
      },
    ];

    jest.spyOn(repo, 'createQueryBuilder').mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),

      getRawMany: jest.fn().mockResolvedValue(mockJobDetails),
    } as any);
    const result = await service.getAllJobConfig(projectId);

    expect(result).toMatchObject<Partial<JobListingDTO>[]>([
      {
        jobConfigId: '1',
        jobType: 'COPY',
        jobStatus: 'ACTIVE',

        sourceServer: {
          serverName: 'SourceServer',
          path: '/source/path',
          protocol: 'HTTP',
        },
        destinationServer: {
          serverName: 'TargetServer',
          path: '/target/path',
          protocol: 'FTP',
        },
        errors: 0,
        totalRuns: 5,
        configName: undefined,
      },
      {
        jobConfigId: '2',
        jobType: 'DELETE',
        jobStatus: 'INACTIVE',
        sourceServer: {
          serverName: 'SourceServerOnly',
          path: '/source/only',
          protocol: 'HTTPS',
        },
        destinationServer: {},
        errors: 0,
        totalRuns: 0,
        configName: undefined,
      },
    ]);

    expect(repo.createQueryBuilder).toHaveBeenCalled();
    expect(repo.createQueryBuilder().getRawMany).toHaveBeenCalled();
  });

  it('should handle empty job configurations', async () => {
    const projectId = '123';
    jest.spyOn(repo, 'createQueryBuilder').mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),

      getRawMany: jest.fn().mockResolvedValue([]),
    } as any);
    const result = await service.getAllJobConfig(projectId);
    expect(result).toEqual([]);
  });

  it('should return job configuration by ID with job runs and stats', async () => {
    const jobConfigId = '123';
    const mockJobConfig = {
      id: jobConfigId,
      jobType: 'COPY',
      status: 'ACTIVE',
      sourcePath: {
        volumePath: '/source/path',
        fileServer: {
          protocol: 'HTTP',
          config: { configName: 'SourceServer' },
        },
      },
      targetPath: {
        volumePath: '/target/path',
        fileServer: {
          protocol: 'FTP',
          config: { configName: 'TargetServer' },
        },
      },
      jobRuns: [
        {
          id: 'run1',
          status: 'SUCCESS',
          startTime: new Date(Date.now() - 10000),
          endTime: new Date(),
        },
      ],
      createdAt: new Date(),
    };

    const mockInventoryStats = {
      filecount: '10',
      directorycount: '2',
      totalsize: '1024',
    };
    jest.spyOn(repo,'findOne').mockResolvedValue(mockJobConfig as any);
    jest.spyOn(inventoryRepo, 'createQueryBuilder').mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue(mockInventoryStats),
    } as any);
    const result = await service.getJobConfigById(jobConfigId);

    expect(result).toEqual({
      jobConfigId: jobConfigId,
      jobType: 'COPY',
      sourceServer: {
        serverName: 'SourceServer',
        path: '/source/path',
        protocol: 'HTTP',
      },
      destinationServer: {
        serverName: 'TargetServer',
        path: '/target/path',
        protocol: 'FTP',
      },
      status: 'ACTIVE',
      createdAt: mockJobConfig.createdAt,
      jobRuns: [
        {
          jobRunId: 'run1',
          status: 'SUCCESS',
          startTime: mockJobConfig.jobRuns[0].startTime,
          endTime: mockJobConfig.jobRuns[0].endTime,
          jobType: 'COPY',
          timeElapsed: mockJobConfig.jobRuns[0].endTime.getTime() - mockJobConfig.jobRuns[0].startTime.getTime(),
          scannedFilesCount: '10',
          scannedDirectoriesCount: '2',
          totalScannedSize: '1.00 KB',
          errors: [],
        },
      ],
      errors: [],
    });
  });

  it('should return job configuration by ID with job runs and stats 2', async () => {
    const jobConfigId = '123';
    const mockJobConfig = {
      jobConfigId: jobConfigId,
      jobType: 'COPY',
      status: 'ACTIVE',
      sourcePath: null,
      targetPath: null,
      jobRuns: [
        {
          id: 'run1',
          status: 'SUCCESS',
          startTime: new Date(Date.now() - 10000),
          endTime: new Date(),
        },
      ],
      createdAt: new Date(),
    };

    const mockInventoryStats = {
      filecount: '10',
      directorycount: '2',
      totalsize: '1024',
    };
    jest.spyOn(repo,'findOne').mockResolvedValue(mockJobConfig as any);
    jest.spyOn(inventoryRepo, 'createQueryBuilder').mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue(mockInventoryStats),
    } as any);
    const result = await service.getJobConfigById(jobConfigId);

    expect(result).toEqual({
      jobConfigId:'123',
      jobType: 'COPY',
      sourceServer: {
        serverName: null,
        path:null,
        protocol: null,
      },
      destinationServer: {
      },
      status: 'ACTIVE',
      createdAt: mockJobConfig.createdAt,
      jobRuns: [
        {
          jobRunId: 'run1',
          status: 'SUCCESS',
          startTime: mockJobConfig.jobRuns[0].startTime,
          endTime: mockJobConfig.jobRuns[0].endTime,
          jobType: 'COPY',
          timeElapsed: mockJobConfig.jobRuns[0].endTime.getTime() - mockJobConfig.jobRuns[0].startTime.getTime(),
          scannedFilesCount: '10',
          scannedDirectoriesCount: '2',
          totalScannedSize: '1.00 KB',
          errors: [],
        },
      ],
      errors: [],
    });
  });

  it('should handle job configuration not found', async () => {
    const jobConfigId = '123';

    jest.spyOn(repo,'findOne').mockResolvedValue(null);
    await expect(service.getJobConfigById(jobConfigId)).rejects.toThrow(`Job with id ${jobConfigId} not found`);
  });

  describe('service.covertBytes', () => {
    it('should return bytes for values less than 1024', () => {
        expect(service.covertBytes(500)).toBe('500 B');
        expect(service.covertBytes(0)).toBe('0 B');
    });

    it('should return kilobytes for values between 1024 and 1 MB', () => {
        expect(service.covertBytes(1024)).toBe('1.00 KB');
        expect(service.covertBytes(1536)).toBe('1.50 KB');
    });

    it('should return megabytes for values between 1 MB and 1 GB', () => {
        expect(service.covertBytes(1048576)).toBe('1.00 MB'); // 1 MB
        expect(service.covertBytes(2097152)).toBe('2.00 MB'); // 2 MB
        expect(service.covertBytes(1572864)).toBe('1.50 MB'); // 1.5 MB
    });

    it('should return gigabytes for values between 1 GB and 1 TB', () => {
        expect(service.covertBytes(1073741824)).toBe('1.00 GB'); // 1 GB
        expect(service.covertBytes(2147483648)).toBe('2.00 GB'); // 2 GB
        expect(service.covertBytes(1610612736)).toBe('1.50 GB'); // 1.5 GB
    });

    it('should return terabytes for values between 1 TB and 1 PB', () => {
        expect(service.covertBytes(1099511627776)).toBe('1.00 TB'); // 1 TB
        expect(service.covertBytes(2199023255552)).toBe('2.00 TB'); // 2 TB
        expect(service.covertBytes(1649267441664)).toBe('1.50 TB'); // 1.5 TB
    });

    it('should return petabytes for values greater than or equal to 1 PB', () => {
        expect(service.covertBytes(1125899906842624)).toBe('1.00 PB'); // 1 PB
        expect(service.covertBytes(2251799813685248)).toBe('2.00 PB'); // 2 PB
        expect(service.covertBytes(1693247244558336)).toBe('1.50 PB'); // 1.5 PB
    });

    it('should handle very large numbers gracefully', () => {
        expect(service.covertBytes(1125899906842624000)).toBe('1000.00 PB'); // 1000 PB
    });
});

  describe('createBulkMigrate', () => {
    it('should return success for bulk migrate', async () => {
      const mokcResult = [
        {
          id: 'b84f2e0a-c013-4c19-9fe7-4ff8c7d65d39',
          jobType: JobType.Migrate,
          status: JobStatus.Active,
          excludeOlderThan: new Date('2025-02-01T00:00:00.000Z'),
          excludeFilePatterns: '*.log, *.tmp',
          preserveAccessTime: false,
          firstRunAt: new Date('2025-01-25T12:00:00+00:00'),
          futureScheduleAt: '0 12 * * *',
          sourcePathId: 'e98cb64f-57d5-40b7-b7fe-1c4fda581b6d',
          targetPathId: ['fc3d1b79-7288-4d8d-8bc3-ec0b7753dbfc'],
          scheduler: '0 12 * * *',
        }
      ] as any;

      const res = await service.createBulkMigrate({} as any);
      expect(res).toEqual(mokcResult);
      expect(res.length).toEqual(1);
      expect(res[0].jobType).toEqual(JobType.Migrate);
      expect(res[0].status).toEqual(JobStatus.Active);
    })
  })

  describe('createBulkCutover', () => {
    it('should return success for bulk cutover', async () => {
      const mokcResult = [
        {
          id: 'b84f2e0a-c013-4c19-9fe7-4ff8c7d65d39',
          jobType: JobType.CutOver,
          status: JobStatus.Active,
          firstRunAt: new Date('2025-01-25T12:00:00+00:00'),
          sourcePathId: 'e98cb64f-57d5-40b7-b7fe-1c4fda581b6d',
          targetPathId: ['fc3d1b79-7288-4d8d-8bc3-ec0b7753dbfc'],
        }
      ] as any;

      const res = await service.createBulkCutover({} as any);
      expect(res).toEqual(mokcResult);
      expect(res.length).toEqual(1);
      expect(res[0].jobType).toEqual(JobType.CutOver);
      expect(res[0].status).toEqual(JobStatus.Active);
    })
  })

  describe('precheck', () => {
    it('should return succes for precheck', async () => {
      const result = await service.precheck({} as any);
      expect(result.status).toEqual('success');
    })
  })
});