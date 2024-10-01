import { Test, TestingModule } from '@nestjs/testing';
import { JobController } from './job.controller';
import { JobService } from './job.service';
import { JobDTO } from '../dto/job.dto';
import { JobEntity } from '../entities/job.entity';

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
  created_at: new Date(),
  updated_at: new Date(),
  created_by: '',
  updated_by: ''
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
  created_by: '',
  updated_by: ''
};

describe('JobController', () => {
  let controller: JobController;
  let service: JobService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobController],
      providers: [
        {
          provide: JobService,
          useValue: {
            createJob: jest.fn().mockResolvedValue(mockJobEntity),
            getJobById: jest.fn().mockResolvedValue(mockJobEntity),
            updateJob: jest.fn().mockResolvedValue(mockJobEntity),
            deleteJob: jest.fn().mockResolvedValue({ message: 'Job with id uuid1 has been deleted' }),
            getAllJob: jest.fn().mockResolvedValue([mockJobEntity]),
          },
        },
      ],
    }).compile();

    controller = module.get<JobController>(JobController);
    service = module.get<JobService>(JobService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createJob', () => {
    it('should create a job', async () => {
      const result = await controller.createJob(mockJobDto);
      expect(result).toEqual(mockJobEntity);
      expect(service.createJob).toHaveBeenCalledWith(mockJobDto);
    });
  });

  describe('getJobById', () => {
    it('should return a job by id', async () => {
      const result = await controller.getJobById('uuid1');
      expect(result).toEqual(mockJobEntity);
      expect(service.getJobById).toHaveBeenCalledWith('uuid1');
    });
  });

  describe('updateJob', () => {
    it('should update a job', async () => {
      const result = await controller.updateJob('uuid1', mockJobDto);
      expect(result).toEqual(mockJobEntity);
      expect(service.updateJob).toHaveBeenCalledWith('uuid1', mockJobDto);
    });
  });

  describe('deleteJob', () => {
    it('should delete a job by id', async () => {
      const result = await controller.deleteJob('uuid1');
      expect(result).toEqual({ message: 'Job with id uuid1 has been deleted' });
      expect(service.deleteJob).toHaveBeenCalledWith('uuid1');
    });
  });

  describe('getAllJob', () => {
    it('should return all jobs', async () => {
      const result = await controller.getAllJob();
      expect(result).toEqual([mockJobEntity]);
      expect(service.getAllJob).toHaveBeenCalled();
    });
  });
});
