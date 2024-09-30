import { Test, TestingModule } from '@nestjs/testing';
import { JobService } from './job.service';
import { JobEntity } from '../entities/job.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobDTO } from '../dto/job.dto';

const mockJobEntity: JobEntity = {
  id: 'uuid1',
  source_config_id: 'uuid-source',
  target_config_id: 'uuid-target',
  file_filters: '*.txt',
  recursive_flag: true,
  timeout: 300,
  retries: 3,
  network_throtlling: 200,
  overwrite_policy: false,
  file_permissions: '755',
  cron_settings: true,
  integrative_algorithms: 'alg-1',
  notification: 'email',
  chunk_size: 1024,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: '',
  updatedBy: ''
};

const mockJobDto: JobDTO = {
  source_config_id: 'uuid-source',
  target_config_id: 'uuid-target',
  file_filters: '*.txt',
  recursive_flag: true,
  timeout: 300,
  retries: 3,
  network_throtlling: 200,
  overwrite_policy: false,
  file_permissions: '755',
  cron_settings: true,
  integrative_algorithms: 'alg-1',
  notification: 'email',
  chunk_size: 1024,
};

describe('JobService', () => {
  let service: JobService;
  let repo: Repository<JobEntity>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobService,
        {
          provide: getRepositoryToken(JobEntity),
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

    service = module.get<JobService>(JobService);
    repo = module.get<Repository<JobEntity>>(getRepositoryToken(JobEntity));
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
      expect(repo.create).toHaveBeenCalledWith(mockJobDto);
      expect(repo.save).toHaveBeenCalledWith(mockJobEntity);
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
