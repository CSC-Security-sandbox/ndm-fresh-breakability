import { Test, TestingModule } from '@nestjs/testing';
import { JobConfigService } from './jobconfig.service';
import { JobConfigEntity, } from '../entities/jobconfig.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateJobConfigDto } from '../dto/jobconfig.dto';

const mockJobEntity: JobConfigEntity = {
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
  firstRunAt: '',
  futureSchedule: null,
  jobRun: null,
  sourcePath:null,
  targetPath:null,
  status: JobStatus.Active
};

const mockJobDto: CreateJobConfigDto = {
  createdBy: '',
  updatedBy: '',
  jobType: JobType.Scan,
  sourcePathId: '',
  status: JobStatus.Active, 
  preserveAccessTime: false, 
  incrementalSchedule: null, 
  targetPathId: '',
  jobSchedule: {
    type: JobScheduleType.Date,
    schedule: new Date().toString()
  }
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
    it('should create a job', async () => {
      jest.spyOn(repo, 'create').mockReturnValue(mockJobEntity);
      jest.spyOn(repo, 'save').mockResolvedValue(mockJobEntity);

      const result = await service.createJobConfig(mockJobDto);
      expect(result).toEqual(mockJobEntity);
      expect(repo.create).toHaveBeenCalled();
      expect(repo.save).toHaveBeenCalled();
    });
  });

  describe('getJobConfigById', () => {
    it('should return a job by id', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(mockJobEntity);

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
      jest.spyOn(repo, 'findOne').mockResolvedValue(mockJobEntity);
      jest.spyOn(repo, 'save').mockResolvedValue(mockJobEntity);

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
      jest.spyOn(repo, 'findOne').mockResolvedValue(mockJobEntity);
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

  describe('getAllJobConfig', () => {
    it('should return all jobs', async () => {
      jest.spyOn(repo, 'find').mockResolvedValue([mockJobEntity]);

      const result = await service.getAllJobConfig();
      expect(result).toEqual([mockJobEntity]);
      expect(repo.find).toHaveBeenCalled();
    });
  });
});
