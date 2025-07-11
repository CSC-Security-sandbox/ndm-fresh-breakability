import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AuthService } from 'src/auth/auth.service';
import { WorkersConfig } from 'src/config/app.config';
import { RedisService } from 'src/redis/redis.service';
import { CommonActivityService } from '../common/common.service';
import { DiscoveryActivity } from './discovery.activities';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import * as utils from '../utils/utils';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;
const { patch, post } = mockedAxios;

describe('DiscoveryActivity', () => {
  let service: DiscoveryActivity;
  let configService: Partial<ConfigService>;
  let authService: Partial<AuthService>;
  let logger: Partial<LoggerService>;
  let redisService: Partial<RedisService>;
  let commonService: Partial<CommonActivityService>;

  const traceId = 'trace-1';
  const jobRunId = 'run-42';

  const createJobContext = () => ({
    groupReadTasks: jest.fn().mockResolvedValue((async function* () { yield { id: 't1' }; })()),
    groupReadDirs: jest.fn().mockResolvedValue((async function* () { })()),
    appendToTaskList: jest.fn().mockResolvedValue('task-1'),
    appendToFileList: jest.fn().mockResolvedValue('file-1'),
    tasksInfo: { lastId: null },
    errorsInfo: { lastId: null },
    jobRunId,
  });

  beforeEach(async () => {
    logger = { log: jest.fn(), error: jest.fn() };

    const mockLoggerFactory = {
      create: jest.fn().mockReturnValue(logger),
    };
  
    configService = { get: jest.fn().mockImplementation(key => key === 'worker.workerId' ? 'worker-x' : 'http://report') };
    authService = { getAccessToken: jest.fn().mockResolvedValue('token-abc') };
    const fakeContext = createJobContext();
    redisService = { getJobContext: jest.fn().mockResolvedValue(fakeContext), setJobContext: jest.fn() };
    commonService = { getJobState: jest.fn().mockResolvedValue({ tasks_total: 0, tasks_completed: 0, workers: [], workers_agreed: [], status: undefined }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscoveryActivity,
        { provide: ConfigService, useValue: configService },
        { provide: AuthService, useValue: authService },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
        { provide: RedisService, useValue: redisService },
        { provide: CommonActivityService, useValue: commonService },
      ],
    }).compile();

    service = module.get<DiscoveryActivity>(DiscoveryActivity);
  });

  describe('getWorkerId', () => {
    it('should return workerId from config', async () => {
      await expect(service.getWorkerId()).resolves.toBe('worker-x');
    });
  });

  describe('publishTask', () => {
    const mockedJobContext = {
     jobRunId: '1234',
      jobConfig: {},
      appendToUpdatedTaskList: jest.fn(),
      appendToTaskList: jest.fn(),
      appendToFileList: jest.fn(),
      appendToDirList: jest.fn(),
      appendToErrorList: jest.fn(),
      appendToMigrationTask: jest.fn(),
      appendToTaskStats: jest.fn(),
      appendToTaskStatsList: jest.fn(),
      jobState: {
        workers: [],
        tasks_completed: 1,
        tasks_total: 2,
        workers_agreed: [],
        status: 'RUNNING',
        failedWorkers: []
      },
      jobRunStatus: 'RUNNING',
      updatedTaskInfo: {
        lastId: 'task-id'
      },
      migrateTask: {
        lastId: 'task-id',
      }
    }
    it('should handle errors and return error response', async () => {
      (redisService.getJobContext as jest.Mock).mockRejectedValueOnce(new Error('ctx fail'));
      const result = await service.publishTask(traceId);
      expect(logger.error).toHaveBeenCalledWith(`[${traceId}] Error in publishing task: ctx fail`);
      expect(result).toEqual({ traceId, status: 'error', message: `Failed to publish task for Job run id ${traceId} : Error: ctx fail` });
    });

    it('Should publish discovery task successfully', async () => {
      jest.spyOn(utils, 'buildTask').mockReturnValue({
        type: 'SCAN',
        jobRunId: 'job-123',
        jobContext: mockedJobContext,
      } as any);
      const result = await service.publishTask({ jobContext: mockedJobContext, commands: [] } as any);
    });
  });

  describe('discoveryStatusUpdate', () => {
    const url = 'http://job';
    beforeEach(() => WorkersConfig.get = jest.fn().mockReturnValue(url));
    it('should log and update status when token present', async () => {
      patch.mockResolvedValue({});
      const res = await service.discoveryStatusUpdate(traceId, 'COMPLETE');
      expect(logger.log).toHaveBeenCalledWith(`[${traceId}] Updating discovery status to COMPLETE`);
      expect(authService.getAccessToken).toHaveBeenCalled();
      expect(patch).toHaveBeenCalledWith(`${url}/${traceId}/COMPLETE`, { headers: { Authorization: `Bearer token-abc` } });
      expect(logger.log).toHaveBeenCalledWith(`[${traceId}] Discovery status updated to COMPLETE`);
      expect(res).toEqual({ message: 'Discovery Job status updated as completed for job id: ' + traceId });
    });

    it('should handle missing token', async () => {
      (authService.getAccessToken as jest.Mock).mockResolvedValueOnce(null);
      const res = await service.discoveryStatusUpdate(traceId, 'FAIL');
      expect(logger.log).toHaveBeenCalledWith(`[${traceId}] Updating discovery status to FAIL`);
      expect(logger.error).toHaveBeenCalledWith(`[${traceId}] Failed to update discovery status: Error: Access token is null`);
      expect(res).toEqual({ message: 'Error while updating the satus of the job id : ' + traceId });
    });

    it('should handle axios error', async () => {
      patch.mockRejectedValueOnce(new Error('patch error'));
      const res = await service.discoveryStatusUpdate(traceId, 'RUN');
      expect(logger.error).toHaveBeenCalledWith(`[${traceId}] Failed to update discovery status: Error: patch error`);
      expect(res).toEqual({ message: 'Error while updating the satus of the job id : ' + traceId });
    });
  });

  describe('publishLastEntry', () => {
    it('should publish last entry and return success', async () => {
      const res = await service.publishLastEntry(traceId);
      expect(logger.log).toHaveBeenCalledWith(`[${traceId}] Publishing last entry for job id: ${traceId}`);
      expect(logger.log).toHaveBeenCalledWith(`[${traceId}] Last entry published for job id: ${traceId}`);
      expect(res).toEqual({ message: 'Discovery Job completed for job id: ' + traceId });
    });

    it('should handle getJobContext errors', async () => {
      (redisService.getJobContext as jest.Mock).mockRejectedValueOnce(new Error('ctx error'));
      const res = await service.publishLastEntry(traceId);
      expect(logger.error).toHaveBeenCalledWith(`[${traceId}] Error while marking the job as completed : Error: ctx error`);
      expect(res).toEqual({ message: 'Error while marking the job as completed : ' + traceId });
    });

    it('should handle appendToFileList errors', async () => {
      const fakeCtx: any = createJobContext();
      (redisService.getJobContext as jest.Mock).mockResolvedValueOnce(fakeCtx);
      fakeCtx.appendToFileList = jest.fn().mockRejectedValueOnce(new Error('append fail'));
      const res = await service.publishLastEntry(traceId);
      expect(logger.error).toHaveBeenCalledWith(`[${traceId}] Error while marking the job as completed : Error: append fail`);
      expect(res).toEqual({ message: 'Error while marking the job as completed : ' + traceId });
    });
  });

  describe('generateDiscoveryReport', () => {
    it('should generate report when token present', async () => {
      post.mockResolvedValue({});
      const res = await service.generateDiscoveryReport(jobRunId);
      expect(logger.log).toHaveBeenCalledWith(`[${jobRunId}] reportServiceUrl to URL ${service.reportServiceUrl}/api/v1/report`);
      expect(logger.log).toHaveBeenCalledWith(`[${jobRunId}] Trigger generateDiscoveryReport `);
      expect(authService.getAccessToken).toHaveBeenCalled();
      expect(post).toHaveBeenCalledWith(
        `${service.reportServiceUrl}/api/v1/report/inventory/generate-report`,
        { jobRunId, 'report-type': 'DISCOVER' },
        { headers: { Authorization: `Bearer token-abc` } }
      );
      expect(logger.log).toHaveBeenCalledWith(`[${jobRunId}] Trigger generateDiscoveryReport Successful`);
      expect(res).toEqual({ message: 'Trigger generateDiscoveryReport Successful for job id: ' + jobRunId });
    });

    it('should handle missing token', async () => {
      (authService.getAccessToken as jest.Mock).mockResolvedValueOnce(null);
      const res = await service.generateDiscoveryReport(jobRunId);
      expect(logger.error).toHaveBeenCalledWith(`[${jobRunId}] Failed to Trigger generateDiscoveryReport: Error: Failed to get access token`);
      expect(res).toEqual({ message: 'Error while Trigger generateDiscoveryReport the status of the job id : ' + jobRunId });
    });

    it('should handle axios error', async () => {
      post.mockRejectedValueOnce(new Error('post fail'));
      const res = await service.generateDiscoveryReport(jobRunId);
      expect(logger.error).toHaveBeenCalledWith(`[${jobRunId}] Failed to Trigger generateDiscoveryReport: Error: post fail`);
      expect(res).toEqual({ message: 'Error while Trigger generateDiscoveryReport the status of the job id : ' + jobRunId });
    });

    it('should handle error when buildTask or ackDirAndCreateTask throws', async () => {
      // Mock jobContext with groupReadWithoutAckDirs yielding two dirs
      const fakeJobContext = {
      groupReadWithoutAckDirs: jest.fn().mockImplementation(async function* () {
        yield { data: { path: '/foo' }, id: 'id1' };
        yield { data: { path: '/bar' }, id: 'id2' };
      }),
      ackDirAndCreateTask: jest.fn().mockRejectedValue(new Error('ack fail')),
      };
      (redisService.getJobContext as jest.Mock).mockResolvedValueOnce(fakeJobContext);

      // Mock buildTask to return a dummy task
      jest.mock('../utils/utils', () => ({
      buildTask: jest.fn().mockReturnValue({}),
      generateDummyFileEntry: {},
      }));

      const result = await service.publishTask(traceId);
      expect(logger.error).toHaveBeenCalled();
      expect(result.status).toBe('error');
      expect(result.message).toContain('Failed to publish task for Job run id');
    });

    it('should handle empty directories gracefully', async () => {
      // Mock jobContext with groupReadWithoutAckDirs yielding nothing
      const fakeJobContext = {
      groupReadWithoutAckDirs: jest.fn().mockImplementation(async function* () { }),
      ackDirAndCreateTask: jest.fn(),
      };
      (redisService.getJobContext as jest.Mock).mockResolvedValueOnce(fakeJobContext);

      const result = await service.publishTask(traceId);
      expect(logger.log).toHaveBeenCalledWith(`[${traceId}] Total commands to publish: 0`);
      expect(result).toEqual({ status: 'success', message: 'Task published successfully' });
    });
  });
});
