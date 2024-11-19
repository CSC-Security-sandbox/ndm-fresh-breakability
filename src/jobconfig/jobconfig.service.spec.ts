import { Test, TestingModule } from '@nestjs/testing';
import { JobConfigService } from './jobconfig.service';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobConfigDTO } from '../dto/jobconfig.dto';

const mockJobEntity: JobConfigEntity = {
  id: 'uuid',
  status: 'RUNNING',
  schedule_time: new Date(),
  job_type: 'discovery',
  path_id: '',
  file_server_id: '',
  createdBy: '',
  updatedBy: '',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockJobDto: JobConfigDTO = {
  jobSchedule: new Date(),
  jobType: 'discovery',
  pathList: [''],
  fileServerId: '',
  created_by: '',
  updated_by: ''
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

  describe('createJob', () => {
    it('should create a job', async () => {
      jest.spyOn(repo, 'create').mockReturnValue(mockJobEntity);
      jest.spyOn(repo, 'save').mockResolvedValue(mockJobEntity);

      const result = await service.createJob(mockJobDto);
      expect(result).toEqual(mockJobEntity);
      expect(repo.create).toHaveBeenCalled();
      expect(repo.save).toHaveBeenCalled();
    });
  });

  describe('getJobById', () => {
    it('should return a job by id', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(mockJobEntity);

      const result = await service.getJobById('uuid1');
      expect(result).toEqual(mockJobEntity);
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'uuid1' } });
    });

    it('should throw an error if job not found', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(undefined);

      await expect(service.getJobById('uuid1')).rejects.toThrowError(
        'Job with id uuid1 not found',
      );
    });
  });

  describe('updateJob', () => {
    it('should update a job', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(mockJobEntity);
      jest.spyOn(repo, 'save').mockResolvedValue(mockJobEntity);

      const result = await service.updateJob('uuid1', mockJobDto);
      expect(result).toEqual(mockJobEntity);
      expect(repo.save).toHaveBeenCalledWith(mockJobEntity);
    });

    it('should throw an error if job not found', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(undefined);

      await expect(service.updateJob('uuid1', mockJobDto)).rejects.toThrowError(
        'Job with id uuid1 not found',
      );
    });
  });

  describe('deleteJob', () => {
    it('should delete a job by id', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(mockJobEntity);
      jest.spyOn(repo, 'remove').mockResolvedValue(undefined);

      const result = await service.deleteJob('uuid1');
      expect(result).toEqual({ message: 'Job with id uuid1 has been deleted' });
      expect(repo.remove).toHaveBeenCalledWith(mockJobEntity);
    });

    it('should throw an error if job not found', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(undefined);

      await expect(service.deleteJob('uuid1')).rejects.toThrowError(
        'Job with id uuid1 not found',
      );
    });
  });

  describe('getAllJob', () => {
    it('should return all jobs', async () => {
      jest.spyOn(repo, 'find').mockResolvedValue([mockJobEntity]);

      const result = await service.getAllJob();
      expect(result).toEqual([mockJobEntity]);
      expect(repo.find).toHaveBeenCalled();
    });
  });
});
