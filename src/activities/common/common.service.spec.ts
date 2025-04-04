import { Test, TestingModule } from '@nestjs/testing';

import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';
import axios from 'axios';
import { getAccessToken } from './token.util';
import { JobRunStatus } from '../discovery/enums';
import { HttpService } from '@nestjs/axios';
import { CommonActivityService } from './common.service';

jest.mock('axios');
jest.mock('./token.util');

describe('CommonActivityService', () => {
  let service: CommonActivityService;
  let configService: ConfigService;
  let httpService: HttpService;
  let logger: Logger;
  let redisService: RedisService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommonActivityService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'worker.workerId') return 'worker-1';
              if (key === 'worker.workerJobServiceUrl')
                return 'http://job-service';
              if (key === 'worker.workerReportServiceUrl')
                return 'http://report-service';
            }),
          },
        },
        { provide: HttpService, useValue: {} },
        {
          provide: Logger,
          useValue: { log: jest.fn(), error: jest.fn() },
        },
        {
          provide: RedisService,
          useValue: {
            getJobContext: jest.fn(),
            setJobContext: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CommonActivityService>(CommonActivityService);
    configService = module.get<ConfigService>(ConfigService);
    httpService = module.get<HttpService>(HttpService);
    logger = module.get<Logger>(Logger);
    redisService = module.get<RedisService>(RedisService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('updateLastEntry', () => {
    it('should update last entry and return success message', async () => {
      // Fake job context with required append methods and info objects.
      const fakeJobContext = {
        appendToFileList: jest.fn().mockResolvedValue('fileId'),
        appendToDirList: jest.fn().mockResolvedValue('dirId'),
        appendToTaskList: jest.fn().mockResolvedValue('taskId'),
        appendToMigrationTask: jest.fn().mockResolvedValue('migTaskId'),
        appendToUpdatedTaskList: jest.fn().mockResolvedValue('updateTaskId'),
        appendToErrorList: jest.fn().mockResolvedValue('errorTaskId'),
        filesInfo: {},
        dirsInfo: {},
        tasksInfo: {},
        migrateTask: {},
        updatedTaskInfo: {},
      };

      redisService.getJobContext = jest
        .fn()
        .mockResolvedValue(fakeJobContext);
      redisService.setJobContext = jest.fn();

      const result = await service.updateLastEntry('trace-1');

      expect(logger.log).toHaveBeenCalledWith(
        '[trace-1] Publishing last entry for job id: trace-1',
      );
      expect(fakeJobContext.appendToFileList).toHaveBeenCalled();
      expect(fakeJobContext.appendToDirList).toHaveBeenCalled();

    });

    it('should catch error and return error message', async () => {
      redisService.getJobContext = jest
        .fn()
        .mockRejectedValue(new Error('fail'));

      const result = await service.updateLastEntry('trace-1');
      expect(logger.error).toHaveBeenCalled();
      expect(result).toEqual({
        message: 'Error while marking the job as completed : trace-1',
      });
    });
  });

  describe('updateStatus', () => {
    it('should update status successfully', async () => {
      // Setup token retrieval and axios.patch mocks.
      (getAccessToken as jest.Mock).mockResolvedValue('dummy-token');
      (axios.patch as jest.Mock).mockResolvedValue({});

      const input = { jobRunId: 'job-1', status: 'completed' };
      const result = await service.updateStatus(input as any);

      expect(logger.log).toHaveBeenCalledWith(
        '[job-1] Updating status to URL http://job-service/api/v1/job-run',
      );
      expect(logger.log).toHaveBeenCalledWith(
        '[job-1] Updating status to completed',
      );
      expect(axios.patch).toHaveBeenCalledWith(
        'http://job-service/api/v1/job-run/job-1/completed',
        {},
        { headers: { Authorization: 'Bearer dummy-token' } },
      );
      expect(result).toEqual({
        message: 'Job status updated for job id: job-1',
      });
    });

    it('should return error message when token is not available', async () => {
      (getAccessToken as jest.Mock).mockResolvedValue(null);

      const input = { jobRunId: 'job-1', status: 'completed' };
      const result = await service.updateStatus(input as any);
      expect(result).toEqual({
        message: 'Error while updating the status of the job id : job-1',
      });
    });

    it('should return error message when axios.patch fails', async () => {
      (getAccessToken as jest.Mock).mockResolvedValue('dummy-token');
      (axios.patch as jest.Mock).mockRejectedValue(new Error('patch error'));

      const input = { jobRunId: 'job-1', status: 'completed' };
      const result = await service.updateStatus(input as any); ;
      expect(result).toEqual({
        message: 'Error while updating the status of the job id : job-1',
      });
    });
  });

  describe('generateJobsReport', () => {
    it('should generate jobs report successfully', async () => {
      (getAccessToken as jest.Mock).mockResolvedValue('dummy-token');
      (axios.post as jest.Mock).mockResolvedValue({});

      const result = await service.generateJobsReport('job-1');
      expect(logger.log).toHaveBeenCalledWith(
        '[job-1] reportServiceUrl to URL http://report-service/api/v1/report',
      );
      expect(logger.log).toHaveBeenCalledWith(
        '[job-1] Triggering generateJobsReport for url : http://report-service/api/v1/report/inventory/generate-jobs-report',
      );
      expect(axios.post).toHaveBeenCalledWith(
        'http://report-service/api/v1/report/inventory/generate-jobs-report',
        { jobRunId: 'job-1' },
        { headers: { Authorization: 'Bearer dummy-token' } },
      );
      expect(result).toEqual({
        message:
          'Triggering generateJobsReport successful for job id: job-1',
      });
    });

    it('should return error message when token not available', async () => {
      (getAccessToken as jest.Mock).mockResolvedValue(null);
      const result = await service.generateJobsReport('job-1');
      expect(result).toEqual({
        message:
          'Error while Triggering generateJobsReport for the job id : job-1',
      });
    });

    it('should return error message when axios.post fails', async () => {
      (getAccessToken as jest.Mock).mockResolvedValue('dummy-token');
      (axios.post as jest.Mock).mockRejectedValue(new Error('post error'));
      const result = await service.generateJobsReport('job-1');
      expect(result).toEqual({
        message:
          'Error while Triggering generateJobsReport for the job id : job-1',
      });
    });
  });

  describe('updateJobErrorStatus', () => {
    it('should call updateStatus and updateLastEntry', async () => {
      service.updateStatus = jest
        .fn()
        .mockResolvedValue({ message: 'Job status updated' });
      service.updateLastEntry = jest
        .fn()
        .mockResolvedValue({ message: 'Job completed' });

      await service.updateJobErrorStatus('job-1');

      expect(service.updateStatus).toHaveBeenCalledWith({
        jobRunId: 'job-1',
        status: JobRunStatus.Errored,
      });
      expect(service.updateLastEntry).toHaveBeenCalledWith('job-1');
    });
  });

  describe('getJobState', () => {
    it('should return job state from job context', async () => {
      const fakeJobContext = {
        getJobState: jest.fn().mockResolvedValue('state123'),
      };
      redisService.getJobContext = jest
        .fn()
        .mockResolvedValue(fakeJobContext);
      const result = await service.getJobState('job-1');
      expect(fakeJobContext.getJobState).toHaveBeenCalled();
      expect(result).toBe('state123');
    });
  });

  describe('setJobState', () => {
    it('should update job state in job context', async () => {
      const fakeJobContext = { jobState: null };
      redisService.getJobContext = jest
        .fn()
        .mockResolvedValue(fakeJobContext);
      redisService.setJobContext = jest.fn().mockResolvedValue(undefined);

      const newJobState = {
        workers: ['w1'],
        tasks_completed: 1,
        tasks_total: 2,
        workers_agreed: ['w1'],
        status: 'completed',
        failedWorkers: [],
      };

      await service.setJobState('job-1', newJobState as any);
      expect(fakeJobContext.jobState).toBeInstanceOf(Object);
      expect(redisService.setJobContext).toHaveBeenCalledWith(
        'job-1',
        fakeJobContext,
      );
    });
  });

  describe('fetchOneTask', () => {
    it('should return a task if available', async () => {
      const fakeTask = { id: 'task1' };
      const fakeJobContext = {
        groupReadTasks: jest.fn().mockResolvedValue([fakeTask]),
      };
      const result = await service.fetchOneTask(fakeJobContext as any);
      expect(result).toBe(fakeTask);
    });

    it('should return undefined if no task is available', async () => {
      const fakeJobContext = {
        groupReadTasks: jest.fn().mockResolvedValue([]),
      };
      const result = await service.fetchOneTask(fakeJobContext as any);
      expect(result).toBeUndefined();
    });

    it('should log error and return undefined on failure', async () => {
      const fakeJobContext = {
        jobRunId: 'job-1',
        groupReadTasks: jest.fn().mockRejectedValue(new Error('fail')),
      };
      const result = await service.fetchOneTask(fakeJobContext as any);
      expect(logger.error).toHaveBeenCalled();
      expect(result).toBeUndefined();
    });
  });

  describe('fetchOneMigrationTask', () => {
    it('should return a migration task if available', async () => {
      const fakeTask = { id: 'migTask1' };
      const fakeJobContext = {
        groupReadMigrationTask: jest.fn().mockResolvedValue([fakeTask]),
        jobRunId: 'job-1',
      };
      const result = await service.fetchOneMigrationTask(fakeJobContext as any);
      expect(result).toBe(fakeTask);
    });

    it('should return undefined if no migration task is available', async () => {
      const fakeJobContext = {
        groupReadMigrationTask: jest.fn().mockResolvedValue([]),
        jobRunId: 'job-1',
      };
      const result = await service.fetchOneMigrationTask(fakeJobContext as any);
      expect(result).toBeUndefined();
    });

    it('should log error and return undefined on failure', async () => {
      const fakeJobContext = {
        jobRunId: 'job-1',
        groupReadMigrationTask: jest.fn().mockRejectedValue(new Error('fail')),
      };
      const result = await service.fetchOneMigrationTask(fakeJobContext as any);
      expect(logger.error).toHaveBeenCalled();
      expect(result).toBeUndefined();
    });
  });
});
