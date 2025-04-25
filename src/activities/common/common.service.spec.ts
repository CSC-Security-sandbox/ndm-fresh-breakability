import { HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import { AuthService } from 'src/auth/auth.service';
import { RedisService } from 'src/redis/redis.service';
import { JobRunStatus } from '../discovery/enums';
import { CommonActivityService } from './common.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('CommonActivityService', () => {
  let service: CommonActivityService;
  let configService: Partial<ConfigService>;
  let httpService: Partial<HttpService>;
  let authService: Partial<AuthService>;
  let logger: Partial<Logger>;
  let redisService: Partial<RedisService>;

  const traceId = 'test-trace';
  const jobRunId = 'run-123';

  const createJobContext = () => ({
    appendToFileList: jest.fn().mockResolvedValue('file-id'),
    appendToDirList: jest.fn().mockResolvedValue('dir-id'),
    appendToTaskList: jest.fn().mockResolvedValue('task-id'),
    appendToMigrationTask: jest.fn().mockResolvedValue('migr-task-id'),
    appendToUpdatedTaskList: jest.fn().mockResolvedValue('upd-task-id'),
    appendToErrorList: jest.fn().mockResolvedValue('err-id'),
    filesInfo: { lastId: null },
    dirsInfo: { lastId: null },
    tasksInfo: { lastId: null },
    migrateTask: { lastId: null },
    updatedTaskInfo: { lastId: null },
    errorsInfo: { lastId: null },
    getJobState: jest.fn().mockResolvedValue({ state: 'ok' }),
    groupReadTasks: jest.fn().mockResolvedValue((async function* () { yield { id: 't1' }; })()),
    groupReadMigrationTask: jest.fn().mockResolvedValue((async function* () { yield { id: 'm1' }; })()),
    jobRunId: jobRunId,
    getMigrationTaskLength: jest.fn().mockResolvedValue(1),
  });

  beforeEach(async () => {
    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        switch (key) {
          case 'worker.workerId': return 'worker-1';
          case 'worker.workerJobServiceUrl': return 'http://job';
          case 'worker.workerReportServiceUrl': return 'http://report';
        }
      }),
    };
    httpService = {};
    authService = {
      getAccessToken: jest.fn().mockResolvedValue('token'),
    };
    logger = {
      log: jest.fn(),
      error: jest.fn(),
    };
    redisService = {
      getJobContext: jest.fn().mockResolvedValue(createJobContext()),
      setJobContext: jest.fn().mockResolvedValue(undefined),
      getJobState: jest.fn().mockResolvedValue({ failedWorkers: ['w1'] }),
      setJobState: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommonActivityService,
        { provide: ConfigService, useValue: configService },
        { provide: HttpService, useValue: httpService },
        { provide: AuthService, useValue: authService },
        { provide: Logger, useValue: logger },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    service = module.get<CommonActivityService>(CommonActivityService);
  });

  describe('constructor', () => {
    it('should set properties correctly from config', () => {
      expect(service.workerId).toBe('worker-1');
      expect(service.workerJobServiceUrl).toBe('http://job');
      expect(service.reportServiceUrl).toBe('http://report');
      expect(service.fetchTaskBatch).toBe(50);
      expect(service.pushTaskDirSize).toBe(500);
    });
  });

  describe('updateLastEntry', () => {
    it('should publish last entries and return success message', async () => {
      const result = await service.updateLastEntry(traceId);
      expect(redisService.getJobContext).toHaveBeenCalledWith(traceId);
      expect(redisService.setJobContext).toHaveBeenCalled();
      expect(result).toEqual({ message: 'Job completed for job id: ' + traceId });
      expect(logger.log).toHaveBeenCalledWith(`[${traceId}] Publishing last entry for job id: ${traceId}`);
      expect(logger.log).toHaveBeenCalledWith(`[${traceId}] Last entry published for job id: ${traceId}`);
    });


    it('should handle errors and return error message', async () => {
      (redisService.getJobContext as jest.Mock).mockRejectedValueOnce(new Error('fail'));
      const result = await service.updateLastEntry(traceId);
      expect(logger.error).toHaveBeenCalled();
      expect(result).toEqual({ message: 'Error while marking the job as completed : ' + traceId });
    });

    it('should handle error during append operations', async () => {
      const fakeCtx = createJobContext();
      (redisService.getJobContext as jest.Mock).mockResolvedValueOnce(fakeCtx);
      (fakeCtx.appendToDirList as jest.Mock).mockRejectedValueOnce(new Error('dir append fail'));
      const result = await service.updateLastEntry(traceId);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Error while marking the job as completed'));
      expect(result).toEqual({ message: expect.stringContaining('Error while marking the job as completed') });
    });
  });

  describe('updateStatus', () => {
    it('should send patch request and return success message', async () => {
      mockedAxios.patch.mockResolvedValueOnce({});
      const input = { jobRunId, status: 'RUNNING' as any };
      const result = await service.updateStatus(input);
      expect(authService.getAccessToken).toHaveBeenCalled();
      expect(mockedAxios.patch).toHaveBeenCalledWith(
        `http://job/api/v1/job-run/${jobRunId}/${input.status}`,
        {},
        { headers: { Authorization: `Bearer token` } },
      );
      expect(result).toEqual({ message: 'Job status updated for job id: ' + jobRunId });
    });

    it('should handle missing token and log error', async () => {
      (authService.getAccessToken as jest.Mock).mockResolvedValueOnce(null);
      const result = await service.updateStatus({ jobRunId, status: 'DONE' as any });
      expect(logger.error).toHaveBeenCalled();
      expect(result).toEqual({ message: 'Error while updating the status of the job id : ' + jobRunId });
    });

    it('should handle axios error gracefully', async () => {
      mockedAxios.patch.mockRejectedValueOnce(new Error('patch fail'));
      const result = await service.updateStatus({ jobRunId, status: 'FAILED' as any });
      expect(logger.error).toHaveBeenCalled();
      expect(result).toEqual({ message: 'Error while updating the status of the job id : ' + jobRunId });
    });
  });

  describe('generateJobsReport', () => {

    it('should trigger report generation and return success message', async () => {
      mockedAxios.post = jest.fn().mockResolvedValueOnce({});
      const result = await service.generateJobsReport(jobRunId);
      expect(authService.getAccessToken).toHaveBeenCalled();
      expect(mockedAxios.post).toHaveBeenCalledWith(
        `http://report/api/v1/report/inventory/generate-jobs-report`,
        { jobRunId },
        { headers: { Authorization: `Bearer token` } },
      );
      expect(result).toEqual({ message: 'Triggering generateJobsReport successful for job id: ' + jobRunId });
      expect(logger.log).toHaveBeenCalledWith(`[${jobRunId}] reportServiceUrl to URL ${service.reportServiceUrl}/api/v1/report`);
      expect(logger.log).toHaveBeenCalledWith(`[${jobRunId}] Triggering generateJobsReport for url : ${service.reportServiceUrl}/api/v1/report/inventory/generate-jobs-report`);
    });

    it('should handle missing token and log error', async () => {
      (authService.getAccessToken as jest.Mock).mockResolvedValueOnce(null);
      const result = await service.generateJobsReport(jobRunId);
      expect(logger.error).toHaveBeenCalled();
      expect(result).toEqual({ message: 'Error while Triggering generateJobsReport for the job id : ' + jobRunId });
    });

    it('should handle axios error gracefully', async () => {
      mockedAxios.post = jest.fn().mockRejectedValueOnce(new Error('post fail'));
      const result = await service.generateJobsReport(jobRunId);
      expect(logger.error).toHaveBeenCalled();
      expect(result).toEqual({ message: 'Error while Triggering generateJobsReport for the job id : ' + jobRunId });
    });
  });

  describe('updateJobErrorStatus', () => {
    it('should call updateStatus and updateLastEntry', async () => {
      const statusSpy = jest.spyOn(service, 'updateStatus').mockResolvedValue(undefined as any);
      const lastEntrySpy = jest.spyOn(service, 'updateLastEntry').mockResolvedValue(undefined as any);
      await service.updateJobErrorStatus(jobRunId);
      expect(statusSpy).toHaveBeenCalledWith({ jobRunId, status: JobRunStatus.Errored });
      expect(lastEntrySpy).toHaveBeenCalledWith(jobRunId);
    });

    it('should propagate error if updateStatus fails', async () => {
      const statusSpy = jest.spyOn(service, 'updateStatus').mockRejectedValueOnce(new Error('fail'));
      await expect(service.updateJobErrorStatus(jobRunId)).rejects.toThrow('fail');
      expect(statusSpy).toHaveBeenCalled();
    });
  });

  describe('getJobState', () => {
    it('should return job state from context', async () => {
      const state = await service.getJobState(traceId);
      expect(redisService.getJobContext).toHaveBeenCalledWith(traceId);
      expect(state).toEqual({ state: 'ok' });
    });
  });


  describe('getJobStateWithStreamLoad', () => {
    it('should return job state with isStreamOverloaded', async () => {
      await service.getJobStateWithStreamLoad(traceId);
      expect(redisService.getJobContext).toHaveBeenCalledWith(traceId);
    });
  });


  describe('fetchOneTask / fetchOneMigrationTask', () => {
    it('should fetch one task successfully', async () => {
      const fakeCtx = createJobContext();
      const task = await service.fetchOneTask(fakeCtx as any);
      expect(task).toEqual({ id: 't1' });
    });

    it('should skip undefined tasks and return the first valid one', async () => {
      const fakeCtx = createJobContext();
      (fakeCtx.groupReadTasks as jest.Mock).mockResolvedValue((async function*() { yield undefined; yield { id: 't2' }; })());
      const task = await service.fetchOneTask(fakeCtx as any);
      expect(task).toEqual({ id: 't2' });
    });

    it('should return undefined if no tasks', async () => {
      const fakeCtx = createJobContext();
      (fakeCtx.groupReadTasks as jest.Mock).mockResolvedValue((async function*() {})());
      const task = await service.fetchOneTask(fakeCtx as any);
      expect(task).toBeUndefined();
    });

    it('should log and return undefined on error', async () => {
      const fakeCtx = createJobContext();
      (fakeCtx.groupReadTasks as jest.Mock).mockRejectedValueOnce(new Error('fail tasks'));
      const task = await service.fetchOneTask(fakeCtx as any);
      expect(logger.error).toHaveBeenCalled();
      expect(task).toBeUndefined();
    });

    it('should fetch one migration task successfully', async () => {
      const fakeCtx = createJobContext();
      const mtask = await service.fetchOneMigrationTask(fakeCtx as any);
      expect(mtask).toEqual({ id: 'm1' });
    });

    it('should skip undefined migration tasks and return the first valid one', async () => {
      const fakeCtx = createJobContext();
      (fakeCtx.groupReadMigrationTask as jest.Mock).mockResolvedValue((async function*() { yield undefined; yield { id: 'm2' }; })());
      const mtask = await service.fetchOneMigrationTask(fakeCtx as any);
      expect(mtask).toEqual({ id: 'm2' });
    });

    it('should return undefined if no migration tasks', async () => {
      const fakeCtx = createJobContext();
      (fakeCtx.groupReadMigrationTask as jest.Mock).mockResolvedValue((async function*() {})());
      const mtask = await service.fetchOneMigrationTask(fakeCtx as any);
      expect(mtask).toBeUndefined();
    });

    it('should handle migration task errors gracefully', async () => {
      const fakeCtx = createJobContext();
      (fakeCtx.groupReadMigrationTask as jest.Mock).mockRejectedValueOnce(new Error('fail mig'));
      const mtask = await service.fetchOneMigrationTask(fakeCtx as any);
      expect(logger.error).toHaveBeenCalled();
      expect(mtask).toBeUndefined();
    });
  });

})
