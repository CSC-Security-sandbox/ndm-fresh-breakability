import { Test, TestingModule } from '@nestjs/testing';
import { CommonActivityService } from './common.service';
import { ConfigService } from '@nestjs/config';
import { RedisService } from 'src/redis/redis.service';
import { Logger } from '@nestjs/common';
import axios from 'axios';
import { JobRunStatus } from '../discovery/enums';
import { JobState } from '@netapp-cloud-datamigrate/jobs-lib/dist/types/job-state';
import { JobContext, JobStatus, Task } from '@netapp-cloud-datamigrate/jobs-lib';
import { HttpService } from '@nestjs/axios';

jest.mock('axios');

describe('CommonActivityService', () => {
  let service: CommonActivityService;
  let redisService: RedisService;
  let configService: ConfigService;
  let logger: Logger;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommonActivityService,
        { provide: HttpService, useValue: { get: jest.fn(), post: jest.fn(), delete: jest.fn(), update: jest.fn(), patch: jest.fn(), put: jest.fn() } },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key) => {
              return {
                'worker.workerId': 'test-worker-id',
                'worker.workerJobServiceUrl': 'http://localhost:3000',
                'worker.workerReportServiceUrl': 'http://localhost:4000',
              }[key];
            }),
          },
        },
        {
          provide: RedisService,
          useValue: {
            getJobContext: jest.fn().mockResolvedValue({
              appendToFileList: jest.fn().mockResolvedValue(1),
              appendToDirList: jest.fn().mockResolvedValue(1),
              appendToTaskList: jest.fn().mockResolvedValue(1),
              appendToMigrationTask: jest.fn().mockResolvedValue(1),
              appendToUpdatedTaskList: jest.fn().mockResolvedValue(1),
              appendToErrorList: jest.fn().mockResolvedValue(1),
              getJobState: jest.fn().mockResolvedValue(new JobState([], 0, 0, [], JobStatus.Running, [])),
            }),
            setJobContext: jest.fn(),
          },
        },
        {
          provide: Logger,
          useValue: {
            log: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CommonActivityService>(CommonActivityService);
    redisService = module.get<RedisService>(RedisService);
    configService = module.get<ConfigService>(ConfigService);
    logger = module.get<Logger>(Logger);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('updateLastEntry', () => {
    it('should update job status', async () => {
      (axios.patch as jest.Mock).mockResolvedValue({ data: {} });
      const response = await service.updateStatus({ jobRunId: '123', status: JobRunStatus.Running });
      expect(response).toEqual({ message: 'Job status updated for job id: 123' });
      expect(axios.patch).toHaveBeenCalledWith('http://localhost:3000/api/v1/job-run/123/RUNNING');
    });

    it('should handle errors while updating job status', async () => {
      (axios.patch as jest.Mock).mockRejectedValue(new Error('Request failed'));
      const response = await service.updateStatus({ jobRunId: '123', status: JobRunStatus.Running });
      expect(response).toEqual({ message: 'Error while updating the status of the job id : 123' });
    });
  });

  describe('generateJobsReport', () => {
    it('should generate jobs report', async () => {
      (axios.post as jest.Mock).mockResolvedValue({ data: {} });
      const response = await service.generateJobsReport('123');
      expect(response).toEqual({ message: 'Triggering generateJobsReport successful for job id: 123' });
      expect(axios.post).toHaveBeenCalledWith('http://localhost:4000/api/v1/report/inventory/generate-jobs-report', { jobRunId: '123' });
    });

    it('should handle errors while generating jobs report', async () => {
      (axios.post as jest.Mock).mockRejectedValue(new Error('Request failed'));
      const response = await service.generateJobsReport('123');
      expect(response).toEqual({ message: 'Error while Triggering generateJobsReport for the job id : 123' });
    });
  });

  describe('getJobState', () => {
    it('should fetch job state', async () => {
      const jobState = await service.getJobState('test-trace-id');
      expect(jobState).toBeInstanceOf(JobState);
    });
  })

  describe('setJobState', () => {
    it('should set job state successfully', async () => {
      const traceId = '12345';
      const mockJobContext = { jobState: null };
      const mockJobState = new JobState(['worker1'], 5, 10, ['worker1'], JobStatus.Running, ['worker2']);
      redisService.getJobContext = jest.fn().mockResolvedValue(mockJobContext);
      redisService.setJobContext = jest.fn();
      await service.setJobState(traceId, mockJobState);
      expect(redisService.getJobContext).toHaveBeenCalledWith(traceId);
      expect(mockJobContext.jobState).toEqual(mockJobState);
      expect(redisService.setJobContext).toHaveBeenCalledWith(traceId, mockJobContext);
    });

    it('should handle errors and log them', async () => {
      const traceId = '12345';
      const mockJobState = new JobState([], 0, 0, [], JobStatus.Pending, []);
      redisService.getJobContext = jest.fn().mockRejectedValue(new Error('Redis error'));
      await expect(service.setJobState(traceId, mockJobState)).rejects.toThrow('Redis error');
    });

    it('should handle missing optional fields in jobState', async () => {
      const traceId = '12345';
      const mockJobContext = {};
      const mockJobState = new JobState(undefined, 5, 10, undefined, JobStatus.Running, undefined);
      redisService.getJobContext = jest.fn().mockResolvedValue(mockJobContext);
      redisService.setJobContext = jest.fn();

      await service.setJobState(traceId, mockJobState);
      expect(redisService.setJobContext).toHaveBeenCalledWith(traceId, mockJobContext);
    });
  })

  describe('fetchOneTask', () => {
    it('should fetch one task', async () => {
      const jobContext = { groupReadTasks: jest.fn().mockResolvedValue([{ id: 'task-1' }]), jobRunId: 'test-run-id' } as unknown as JobContext;
      const task = await service.fetchOneTask(jobContext);
      expect(task).toBeDefined();
    });

    // return undefined; case
    it('should handle errors while fetching task', async () => {
      const jobContext = { groupReadTasks: jest.fn().mockRejectedValue(new Error('Task fetch error')), jobRunId: 'test-run-id' } as unknown as JobContext;
      const task = await service.fetchOneTask(jobContext);
      expect(task).toBeUndefined();
    });

    it('should return undefined if no tasks are available', async () => {
      const jobContext = { groupReadTasks: jest.fn().mockResolvedValue([]), jobRunId: 'test-run-id' } as unknown as JobContext;
      const task = await service.fetchOneTask(jobContext);
      expect(task).toBeUndefined();
    });
  })

  describe('fetchOneMigrationTask', () => {
    it('should fetch one migration task', async () => {
      const jobContext = { groupReadMigrationTask: jest.fn().mockResolvedValue([{ id: 'task-2' }]), jobRunId: 'test-run-id' } as unknown as JobContext;
      const task = await service.fetchOneMigrationTask(jobContext);
      expect(task).toBeDefined();
    });

    // return undefined; case
    it('should handle errors while fetching migration task', async () => {
      const jobContext = { groupReadMigrationTask: jest.fn().mockRejectedValue(new Error('Migration task fetch error')), jobRunId: 'test-run-id' } as unknown as JobContext;
      const task = await service.fetchOneMigrationTask(jobContext);
      expect(task).toBeUndefined();
    });
    it('should return undefined if no migration tasks are available', async () => {
      const jobContext = { groupReadMigrationTask: jest.fn().mockResolvedValue([]), jobRunId: 'test-run-id' } as unknown as JobContext;
      const task = await service.fetchOneMigrationTask(jobContext);
      expect(task).toBeUndefined();
    });
  })

  describe('updateLastEntry', () => {
    it('should update last entry successfully', async () => {
      const traceId = '12345';
      const mockJobContext = {
        appendToFileList: jest.fn().mockResolvedValue('fileId'),
        appendToDirList: jest.fn().mockResolvedValue('dirId'),
        appendToTaskList: jest.fn().mockResolvedValue('taskId'),
        appendToMigrationTask: jest.fn().mockResolvedValue('migrateId'),
        appendToUpdatedTaskList: jest.fn().mockResolvedValue('updateId'),
        appendToErrorList: jest.fn().mockResolvedValue('errorId'),
        filesInfo: {},
        dirsInfo: {},
        tasksInfo: {},
        migrateTask: {},
        updatedTaskInfo: {},
        errorsInfo: {},
      };

      redisService.getJobContext = jest.fn().mockResolvedValue(mockJobContext);
      redisService.setJobContext = jest.fn();

      const result = await service.updateLastEntry(traceId);

      expect(redisService.getJobContext).toHaveBeenCalledWith(traceId);
      expect(mockJobContext.appendToFileList).toHaveBeenCalled();
      expect(mockJobContext.appendToDirList).toHaveBeenCalled();
      expect(mockJobContext.appendToTaskList).toHaveBeenCalled();
      expect(mockJobContext.appendToMigrationTask).toHaveBeenCalled();
      expect(mockJobContext.appendToUpdatedTaskList).toHaveBeenCalled();
      expect(mockJobContext.appendToErrorList).toHaveBeenCalled();
      expect(redisService.setJobContext).toHaveBeenCalledWith(traceId, mockJobContext);
      expect(result).toEqual({ message: `Job completed for job id: ${traceId}` });
    });

    it('should handle errors and log them', async () => {
      const traceId = '12345';
      redisService.getJobContext = jest.fn().mockRejectedValue(new Error('Redis error'));

      const result = await service.updateLastEntry(traceId);

      expect(result).toEqual({ message: `Error while marking the job as completed : ${traceId}` });
    });

    it('should handle failure in setJobContext gracefully', async () => {
      redisService.setJobContext = jest.fn().mockRejectedValue(new Error('Redis set failed'));
      const response = await service.updateLastEntry('12345');
      expect(response).toEqual({ message: 'Error while marking the job as completed : 12345' });
    });
  });

  describe('updateJobErrorStatus', () => {
    it('should update job error status', async () => {
      const jobRunId = '123';
      jest.spyOn(service, 'updateStatus').mockResolvedValue(undefined);
      jest.spyOn(service, 'updateLastEntry').mockResolvedValue(undefined);
      await service.updateJobErrorStatus(jobRunId);
      expect(service.updateStatus).toHaveBeenCalledWith({ jobRunId, status: JobRunStatus.Errored });
      expect(service.updateLastEntry).toHaveBeenCalledWith(jobRunId);
    });
  })

  describe('updateStatus', () => {
    it('should update job status to different states', async () => {
      (axios.patch as jest.Mock).mockResolvedValue({ data: {} });
      const statuses = [JobRunStatus.Pending, JobRunStatus.Completed, JobRunStatus.Errored];
      
      for (const status of statuses) {
        const response = await service.updateStatus({ jobRunId: '123', status });
        expect(response).toEqual({ message: `Job status updated for job id: 123` });
        expect(axios.patch).toHaveBeenCalledWith(`http://localhost:3000/api/v1/job-run/123/${status.toUpperCase()}`);
      }
    });
  });
});
