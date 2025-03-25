import { Test, TestingModule } from '@nestjs/testing';
import { CommonActivityService } from './common.service';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';
import axios from 'axios';
import { JobRunStatus } from '../discovery/enums';
import { JobContext, JobStatus, Task } from '@netapp-cloud-datamigrate/jobs-lib';
import { TaskType, TaskStatus } from '@netapp-cloud-datamigrate/jobs-lib/dist/types/enums';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('CommonActivityService', () => {
  let service: CommonActivityService;
  let mockConfigService: Partial<ConfigService>;
  let mockLogger: Partial<Logger>;
  let mockRedisService: Partial<RedisService>;

  beforeEach(async () => {
    mockConfigService = {
      get: jest.fn((key) => {
        switch (key) {
          case 'worker.workerId':
            return 'test-worker-id';
          case 'worker.workerJobServiceUrl':
            return 'http://localhost/job-service';
          case 'worker.workerReportServiceUrl':
            return 'http://localhost/report-service';
          default:
            return null;
        }
      }),
    };

    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
    };

    mockRedisService = {
      getJobContext: jest.fn().mockResolvedValue({
        appendToFileList: jest.fn().mockResolvedValue('last-id'),
        getJobState: jest.fn().mockResolvedValue({}),
        groupReadTasks: jest.fn().mockResolvedValue([{ 
          id: 'task-id',
          jobRunId: '',
          taskType: TaskType.SCAN,
          status: TaskStatus.PENDING,
          workerId: '',
          sPath: '',
          sPathId: '',
          commands: [],
          serialize: function (): string {
            return 'serialized-task';
          }
        }]),
        groupReadMigrationTask: jest.fn().mockResolvedValue([{ 
          id: 'task-id',
          jobRunId: '',
          taskType: TaskType.SCAN,
          status: TaskStatus.PENDING,
          workerId: '',
          sPath: '',
          sPathId: '',
          commands: [],
          serialize: function (): string {
            return 'serialized-migration-task';
          }
        }]),
      }),
      setJobContext: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommonActivityService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: Logger, useValue: mockLogger },
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<CommonActivityService>(CommonActivityService);
  });

  describe('updateLastEntry', () => {
    // it('should publish the last entry successfully', async () => {
    //   const result = await service.updateLastEntry('trace-id');
    //   expect(result.message).toBe('Job completed for job id: trace-id');
    //   expect(mockLogger.log).toHaveBeenCalledWith('[trace-id] Last entry published for job id: trace-id');
    // });

    it('should handle errors while publishing the last entry', async () => {
      mockRedisService.getJobContext = jest.fn().mockRejectedValue(new Error('Redis error'));
      const result = await service.updateLastEntry('trace-id');
      expect(result.message).toBe('Error while marking the job as completed : trace-id');
      expect(mockLogger.error).toHaveBeenCalledWith('[trace-id] Error while marking the job as completed : Error: Redis error');
    });
  });

  describe('updateStatus', () => {
    it('should update the job status successfully', async () => {
      mockedAxios.patch.mockResolvedValue({ data: {} });
      const result = await service.updateStatus({ jobRunId: 'job-id', status: JobRunStatus.Completed });
      expect(result.message).toBe('Job status updated for job id: job-id');
      expect(mockLogger.log).toHaveBeenCalledWith('[job-id] status updated to COMPLETED');
    });

    it('should handle errors while updating the job status', async () => {
      mockedAxios.patch.mockRejectedValue(new Error('Network error'));
      const result = await service.updateStatus({ jobRunId: 'job-id', status: JobRunStatus.Completed });
      expect(result.message).toBe('Error while updating the status of the job id : job-id');
      expect(mockLogger.error).toHaveBeenCalledWith('[job-id] Failed to update status: Error: Network error');
    });
  });

  describe('generateJobsReport', () => {
    it('should trigger job report generation successfully', async () => {
      mockedAxios.post.mockResolvedValue({ data: {} });
      const result = await service.generateJobsReport('job-id');
      expect(result.message).toBe('Triggering generateJobsReport successful for job id: job-id');
      expect(mockLogger.log).toHaveBeenCalledWith('[job-id] Triggering generateJobsReport successful');
    });

    it('should handle errors while generating job report', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Network error'));
      const result = await service.generateJobsReport('job-id');
      expect(result.message).toBe('Error while Triggering generateJobsReport for the job id : job-id');
      expect(mockLogger.error).toHaveBeenCalledWith('[job-id] Failed to Trigger generateJobsReport: Error: Network error | for url : http://localhost/report-service/api/v1/report/inventory/generate-jobs-report');
    });
  });

  describe('updateJobErrorStatus', () => {
    it('should update job error status and publish last entry', async () => {
      const updateStatusSpy = jest.spyOn(service, 'updateStatus').mockResolvedValue({ message: 'Job status updated' });
      const updateLastEntrySpy = jest.spyOn(service, 'updateLastEntry').mockResolvedValue({ message: 'Job completed' });

      await service.updateJobErrorStatus('job-id');

      expect(updateStatusSpy).toHaveBeenCalledWith({ jobRunId: 'job-id', status: JobRunStatus.Errored });
      expect(updateLastEntrySpy).toHaveBeenCalledWith('job-id');
    });
  });

  describe('getJobState', () => {
    it('should return the job state', async () => {
      const jobState = await service.getJobState('trace-id');
      expect(jobState).toEqual({});
      expect(mockRedisService.getJobContext).toHaveBeenCalledWith('trace-id');
    });
  });

  describe('setJobState', () => {
    it('should set the job state', async () => {
      const jobState: any = {
        workers: [],
        tasks_completed: 0,
        tasks_total: 0,
        workers_agreed: [],
        status: JobStatus.Completed,
        failedWorkers: [],
      };

      await service.setJobState('trace-id', jobState);

      expect(mockRedisService.setJobContext).toHaveBeenCalledWith('trace-id', expect.objectContaining({
        jobState: expect.any(Object),
      }));
    });
  });

  describe('fetchOneTask', () => {
    // it('should fetch one task successfully', async () => {
    //   const mockTask: Task = {
    //     id: 'task-id',
    //     jobRunId: '',
    //     taskType: TaskType.SCAN,
    //     status: TaskStatus.PENDING,
    //     workerId: '',
    //     sPath: '',
    //     sPathId: '',
    //     commands: [],
    //     serialize: function (): string {
    //       throw new Error('Function not implemented.');
    //     }
    //   };
    //   mockRedisService.getJobContext = jest.fn().mockResolvedValue({
    //     groupReadTasks: jest.fn().mockResolvedValue([mockTask]),
    //   });

    //   const task = await service.fetchOneTask({ jobRunId: 'job-id' } as JobContext);
    //   expect(task).toEqual(mockTask);
    //   expect(mockLogger.debug).toHaveBeenCalledWith(`Task: ${JSON.stringify(mockTask)}`);
    // });

    // it('should handle errors while fetching a task', async () => {
    //   mockRedisService.getJobContext = jest.fn().mockResolvedValue({
    //     groupReadTasks: jest.fn().mockRejectedValue(new Error('Redis error')),
    //   });

    //   const task = await service.fetchOneTask({ jobRunId: 'job-id' } as JobContext);
    //   expect(task).toBeUndefined();
    //   expect(mockLogger.error).toHaveBeenCalledWith('[job-id] Failed to fetch the task: Error: Redis error');
    // });
  });

  describe('fetchOneMigrationTask', () => {
    // it('should fetch one migration task successfully', async () => {
    //   const mockTask: Task = {
    //     id: 'task-id',
    //     jobRunId: '',
    //     taskType: TaskType.SCAN,
    //     status: TaskStatus.PENDING,
    //     workerId: '',
    //     sPath: '',
    //     sPathId: '',
    //     commands: [],
    //     serialize: function (): string {
    //       throw new Error('Function not implemented.');
    //     }
    //   };
    //   mockRedisService.getJobContext = jest.fn().mockResolvedValue({
    //     groupReadMigrationTask: jest.fn().mockResolvedValue([mockTask]),
    //   });

    //   const task = await service.fetchOneMigrationTask({ jobRunId: 'job-id' } as JobContext);
    //   expect(task).toEqual(mockTask);
    //   expect(mockLogger.debug).toHaveBeenCalledWith(`Task: ${JSON.stringify(mockTask)}`);
    // });

    // it('should handle errors while fetching a migration task', async () => {
    //   mockRedisService.getJobContext = jest.fn().mockResolvedValue({
    //     groupReadMigrationTask: jest.fn().mockRejectedValue(new Error('Redis error')),
    //   });

    //   const task = await service.fetchOneMigrationTask({ jobRunId: 'job-id' } as JobContext);
    //   expect(task).toBeUndefined();
    //   expect(mockLogger.error).toHaveBeenCalledWith('[job-id] Failed to fetch the task: Error: Redis error');
    // });
  });
});
