import { Test, TestingModule } from '@nestjs/testing';
import { JobConfigController } from './jobconfig.controller';
import { JobConfigService } from './jobconfig.service';
import { CreateJobConfigDto } from '../dto/jobconfig.dto';
import { JobConfigEntity, JobScheduleType, JobStatus, JobType } from '../entities/jobconfig.entity';
import { JobMappingService } from '../jobmappings/jobmapping.service';

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
  incrementalSchedule: null,
  jobSchedule: {
    type: JobScheduleType.Date,
    schedule: new Date().toString(),
  },
  status: JobStatus.Active,
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
    schedule: new Date().toString(),
  },
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
            createJobConfig: jest.fn().mockResolvedValue(mockJobEntity),
            getJobConfigById: jest.fn().mockResolvedValue(mockJobEntity),
            updateJobConfig: jest.fn().mockResolvedValue(mockJobEntity),
            deleteJobConfig: jest.fn().mockResolvedValue({ message: 'Job with id uuid1 has been deleted' }),
            getAllJobConfig: jest.fn().mockResolvedValue([mockJobEntity]),
          },
        },
        {
          provide: JobMappingService,
          useValue: {
            createMany: jest.fn(),
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

  describe('createJobConfig', () => {
    it('should create a job', async () => {
      const result = await controller.createJobConfig(mockJobDto);
      expect(result).toEqual(mockJobEntity);
      expect(service.createJobConfig).toHaveBeenCalledWith(mockJobDto);
    });
  });

  describe('getJobConfigById', () => {
    it('should return a job by id', async () => {
      const result = await controller.getJobConfigById('uuid1');
      expect(result).toEqual(mockJobEntity);
      expect(service.getJobConfigById).toHaveBeenCalledWith('uuid1');
    });

    it('should throw an error if job is not found', async () => {
      service.getJobConfigById = jest.fn().mockRejectedValue(new Error('Job not found'));
      try {
        await controller.getJobConfigById('uuid2');
      } catch (e) {
        expect(e.message).toBe('Job not found');
      }
    });
  });

  describe('updateJobConfig', () => {
    it('should update a job', async () => {
      const result = await controller.updateJobConfig('uuid1', mockJobDto);
      expect(result).toEqual(mockJobEntity);
      expect(service.updateJobConfig).toHaveBeenCalledWith('uuid1', mockJobDto);
    });

    it('should throw an error if job to update is not found', async () => {
      service.updateJobConfig = jest.fn().mockRejectedValue(new Error('Job not found'));
      try {
        await controller.updateJobConfig('uuid2', mockJobDto);
      } catch (e) {
        expect(e.message).toBe('Job not found');
      }
    });
  });

  describe('deleteJobConfig', () => {
    it('should delete a job by id', async () => {
      const result = await controller.deleteJobConfig('uuid1');
      expect(result).toEqual({ message: 'Job with id uuid1 has been deleted' });
      expect(service.deleteJobConfig).toHaveBeenCalledWith('uuid1');
    });

    it('should throw an error if job to delete is not found', async () => {
      service.deleteJobConfig = jest.fn().mockRejectedValue(new Error('Job not found'));
      try {
        await controller.deleteJobConfig('uuid2');
      } catch (e) {
        expect(e.message).toBe('Job not found');
      }
    });
  });

  describe('getAllJobConfig', () => {
    it('should return all jobs', async () => {
      const result = await controller.getAllJobConfig();
      expect(result).toEqual([mockJobEntity]);
      expect(service.getAllJobConfig).toHaveBeenCalled();
    });
  });
});