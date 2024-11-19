import { Test, TestingModule } from '@nestjs/testing';
import { JobConfigController } from './jobconfig.controller';
import { JobConfigService } from './jobconfig.service';
import { JobConfigDTO } from '../dto/jobconfig.dto';
import { JobConfigEntity } from '../entities/jobconfig.entity';

const mockJobEntity: JobConfigEntity = {
  id: 'uuid1',
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: '',
  updatedBy: '',
  job_type: 'discover',
  file_server_id: '',
  path_id: '',
  schedule_time: new Date(),
  status: ''
};

const mockJobDto: JobConfigDTO = {
  created_by: '',
  updated_by: '',
  jobType: 'discover',
  fileServerId: '',
  pathList: [],
  jobSchedule: new Date()
};

describe('JobConfigController', () => {
  let controller: JobConfigController;
  let service: JobConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobConfigController],
      providers: [
        {
          provide: JobConfigService,
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

    controller = module.get<JobConfigController>(JobConfigController);
    service = module.get<JobConfigService>(JobConfigService);
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
