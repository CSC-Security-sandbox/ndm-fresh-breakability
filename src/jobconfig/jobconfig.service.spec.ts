import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JobStatus, JobType } from 'src/constants/enums';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { Repository } from 'typeorm';
import { CreateJobConfigDto } from '../dto/jobconfig.dto';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobConfigDto } from './dto/jobconfig.dto';
import { JobConfigDiscoverBulk } from './dto/jobdicoverybulk.dto';
import { JobConfigService } from './jobconfig.service';
import { JobListingDTO } from './dto/joblisting.dto';

const mockJobEntity = {
  id: 'uuid1',
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: '',
  updatedBy: '',
  jobType: JobType.Scan,
  sourcePathId: '',
  targetPathId: '',
  excludeFilePatterns: '',
  excludeOlderThan: new Date(),
  preserveAccessTime: false,
  futureScheduleAt: null,
  firstRunAt: null,
  status: JobStatus.Active,

};

const mockJobDto: CreateJobConfigDto = {
  createdBy: '',
  updatedBy: '',
  jobType: JobType.Scan,
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

  describe('createJobConfig', () => {
    it('should create and save a job record successfully', async () => {
      const jobConfigData: JobConfigDto = {
        sourcePathId: 'path1',
        excludeFilePatterns: ['*.tmp'],
        preserveAccessTime: true,
        excludeOlderThan: new Date(),
        futureSchedule: new Date(),
        firstRunAt: new Date(),
        createdBy: 'user1',
      }as any;

      const mockJobRecord = {
        ...jobConfigData,
        firstRunAt: jobConfigData.firstRunAt.toISOString(),
      };

      jest.spyOn(repo,'save').mockResolvedValue(mockJobRecord as any);

      const result = await service.createJobConfig(jobConfigData);

      expect(repo.create).toHaveBeenCalledWith({
        ...jobConfigData,
        firstRunAt: jobConfigData.firstRunAt.toISOString(),
      });
      expect(result).toEqual(mockJobRecord);
    });

    it('should set firstRunAt to current date if not provided', async () => {
      const jobConfigData: JobConfigDto = {
        sourcePathId: 'path1',
        excludeFilePatterns: ['*.log'],
        preserveAccessTime: false,
        excludeOlderThan: new Date(),
        futureSchedule: new Date(),
        createdBy: 'user2',
      }as any;;

      const currentDate = new Date().toISOString();
      const mockJobRecord = {
        ...jobConfigData,
        firstRunAt: currentDate,
      };

      jest.spyOn(repo,'save').mockResolvedValue(mockJobRecord as any);


      const result = await service.createJobConfig(jobConfigData);

      expect(repo.create).toHaveBeenCalledWith({
        ...jobConfigData,
        firstRunAt: expect.any(String),
      });
      expect(result.firstRunAt).toBeDefined();
      expect(new Date(result.firstRunAt).toISOString()).toEqual(currentDate);
    });
  });

  describe('createBulkDiscovery', () => {
    it('should create and save job records successfully', async () => {
      const bulkDiscovery: JobConfigDiscoverBulk = {
        sourcePathIds: ['path1', 'path2'],
        excludeFilePatterns: ['*.tmp'],
        preserveAccessTime: true,
        excludeOlderThan: new Date(),
        futureSchedule: new Date(),
        firstRunAt: new Date(),
        createdBy: 'user1',
      } as any;

      const mockJobRecords = bulkDiscovery.sourcePathIds.map((path) => ({
        status: JobStatus.Active,
        excludeFilePatterns: bulkDiscovery.excludeFilePatterns,
        jobType: JobType.Scan,
        preserveAccessTime: bulkDiscovery.preserveAccessTime,
        sourcePathId: path,
        excludeOlderThan: bulkDiscovery.excludeOlderThan,
        futureScheduleAt: bulkDiscovery.futureSchedule,
        firstRunAt: bulkDiscovery.firstRunAt?.toISOString(),
        createdBy: bulkDiscovery.createdBy,
      }));

      jest.spyOn(repo,'save').mockResolvedValue(mockJobRecords as any);

      const result = await service.createBulkDiscovery(bulkDiscovery);

      expect(repo.create).toHaveBeenCalledTimes(2);
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ sourcePathId: 'path1' }));
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ sourcePathId: 'path2' }));
      expect(result).toEqual(mockJobRecords);
    });

    it('should handle missing firstRunAt gracefully', async () => {
      const bulkDiscovery: JobConfigDiscoverBulk = {
        sourcePathIds: ['path1'],
        excludeFilePatterns: '*.log',
        preserveAccessTime: false,
        excludeOlderThan: new Date(),
        futureSchedule: new Date().toISOString(),
        createdBy: 'user2',
      } as any;

      const mockJobRecord = {
        status: JobStatus.Active,
        excludeFilePatterns: bulkDiscovery.excludeFilePatterns,
        jobType: JobType.Scan,
        preserveAccessTime: bulkDiscovery.preserveAccessTime,
        sourcePathId: 'path1',
        excludeOlderThan: bulkDiscovery.excludeOlderThan,
        futureScheduleAt: bulkDiscovery.futureSchedule,
        firstRunAt: expect.any(String), // Default to current date
        createdBy: bulkDiscovery.createdBy,
      };

      jest.spyOn(repo,'save').mockResolvedValue([mockJobRecord] as any);

      const result = await service.createBulkDiscovery(bulkDiscovery);

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ sourcePathId: 'path1' }));
      expect(result[0].firstRunAt).toBeDefined();
    });

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
          totalScannedSize: '1024',
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
          totalScannedSize: '1024',
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


});