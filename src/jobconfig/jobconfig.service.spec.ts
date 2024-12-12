import { Test, TestingModule } from '@nestjs/testing';
import { JobConfigService } from './jobconfig.service';
import { JobConfigEntity} from '../entities/jobconfig.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateJobConfigDto } from '../dto/jobconfig.dto';
import { VolumeEntity } from 'src/entities/volume.entity';
import * as parser from 'cron-parser';
import { log } from 'console';
import {  JobStatus, JobType } from 'src/constants/enums';
import { JobConfigDiscoverBulk } from './dto/jobdicoverybulk.dto';
import { JobConfigDto } from './dto/jobconfig.dto';

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
      ],
    }).compile();

    service = module.get<JobConfigService>(JobConfigService);
    repo = module.get<Repository<JobConfigEntity>>(getRepositoryToken(JobConfigEntity));
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

    // it('should return an empty array if sourcePathIds is empty', async () => {
    //   const bulkDiscovery: JobConfigDiscoverBulk = {
    //     sourcePathIds:null,
    //     excludeFilePatterns: null,
    //     preserveAccessTime: false,
    //     excludeOlderThan: new Date(),
    //     futureSchedule: new Date().toISOString(),
    //     createdBy: 'user3',
    //   }as JobConfigDiscoverBulk;

    //   const result = await service.createBulkDiscovery(bulkDiscovery);

    //   expect(repo.create).not.toHaveBeenCalled();
    //   expect(repo.save).not.toHaveBeenCalled();
    //   expect(result).toEqual([]);
    // });
  });


  describe('getJobConfigById', () => {
    it('should return a job by id', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(mockJobEntity as any);

      const result = await service.getJobConfigById('uuid1');
      expect(result).toEqual(mockJobEntity);
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'uuid1' } });
    });

    it('should throw an error if job not found', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(undefined);

      await expect(service.getJobConfigById('uuid1')).rejects.toThrowError(
        'Job with id uuid1 not found',
      );
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

  it('should return transformed job configurations', async () => {
    jest.spyOn(repo, 'createQueryBuilder').mockImplementation(() => ({
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        {
          jobconfigid: '1',
          jobtype: 'Backup',
          jobconfigstatus: 'Active',
          sourcepathid: 'src1',
          targetpathid: 'dst1',
          futureschedule: '0 0 * * *',
          path: '/source/path',
          protocol: 'NFS',
          configname: 'Config1',
          createdat: new Date(),
        },
      ]),
    }) as any);

    const result = await service.getAllJobConfig();
    log

    expect(result).toEqual([
      {
        jobConfigId: '1',
        jobType: 'Backup',
        jobStatus: 'Active',
        nextScheduleDate: parser.parseExpression('0 0 * * *').next().toDate(),
        sourcePath: '/source/path',
        errors: 0,
        protocol: 'NFS',
        configName: 'Config1',
      },
    ]);
  });
});