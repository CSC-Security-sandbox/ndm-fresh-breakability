import { Test, TestingModule } from '@nestjs/testing';

import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { AuthService } from 'src/auth/auth.service';
import { RedisService } from 'src/redis/redis.service';
import axios from 'axios';
import { JobRunStatus } from './enums';
import { JobContext } from '@netapp-cloud-datamigrate/jobs-lib';
import { CommonActivityService } from './common.service';
import {
  LoggerFactory,
  LoggerService
} from '@netapp-cloud-datamigrate/logger-lib';
import { mockLogger } from 'src/auth/auth.service.spec';

jest.mock('axios');

describe('CommonActivityService', () => {
  let service: CommonActivityService;
  let configService: Partial<ConfigService>;
  let httpService: Partial<HttpService>;
  let authService: Partial<AuthService>;
  let logger: Partial<LoggerService>;
  let redisService: Partial<RedisService>;
  let mockContext: any;

  const traceId = 'test-trace';
  const jobRunId = 'job123';
  const workerId = 'worker1';

  beforeEach(async () => {
    mockContext = {
      cleanup: jest.fn(),
      appendToFileList: jest.fn().mockResolvedValue('fileId'),
      appendToDirList: jest.fn().mockResolvedValue('dirId'),
      appendToTaskList: jest.fn().mockResolvedValue(1),
      appendToMigrationTask: jest.fn().mockResolvedValue(2),
      appendToUpdatedTaskList: jest.fn().mockResolvedValue(3),
      appendToErrorList: jest.fn().mockResolvedValue(4),
      filesInfo: { lastId: null },
      dirsInfo: { lastId: null },
      tasksInfo: { lastId: null },
      migrateTask: { lastId: null },
      updatedTaskInfo: { lastId: null },
      errorsInfo: { lastId: null },
      getJobState: jest.fn().mockResolvedValue({ state: 'OK' }),
      getMigrationTaskLength: jest.fn().mockResolvedValue(0),
      groupReadTasks: jest.fn().mockResolvedValue([Promise.resolve({ id: 't1' })]),
      groupReadMigrationTask: jest.fn().mockResolvedValue([Promise.resolve({ id: 'mt1' })]),
      getAllRunningScanTasks: jest.fn().mockResolvedValue([]),
      getAllRunningSyncTasks: jest.fn().mockResolvedValue([]),
      deleteAllScanTasks: jest.fn(),
      deleteAllSyncTasks: jest.fn(),
      jobRunId: traceId,
    } as unknown as JobContext;

    configService = {
      get: jest.fn((key: string) => {
        const map = {
          'worker.workerId': workerId,
          'worker.connection.workerJobServiceUrl': 'http://job',
          'worker.connection.workerReportServiceUrl': 'http://report',
          'worker.migrationTaskStreamLimit': 5,
        };
        return map[key];
      }),
    };
    httpService = {};
    authService = { getAccessToken: jest.fn().mockResolvedValue('token') };

    const mockLoggerFactory = {
      create: jest.fn().mockReturnValue(mockLogger),
    };

    logger = mockLogger;
    redisService = {
      getJobContext: jest.fn().mockResolvedValue(mockContext),
      setJobContext: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommonActivityService,
        { provide: ConfigService, useValue: configService },
        { provide: HttpService, useValue: httpService },
        { provide: AuthService, useValue: authService },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    service = module.get<CommonActivityService>(CommonActivityService);
  });

  describe('updateStatus', () => {
    it('should update status successfully', async () => {
      (axios.patch as jest.Mock).mockResolvedValue({});
      const res = await service.updateStatus({ jobRunId, status: JobRunStatus.Completed});
      expect(authService.getAccessToken).toHaveBeenCalled();
      expect(axios.patch).toHaveBeenCalledWith(
        `http://job/api/v1/job-run/${jobRunId}/COMPLETED`,
        {},
        { headers: { Authorization: `Bearer token` } },
      );
      expect(res).toEqual({ message: 'Job status updated for job id: ' + jobRunId });
    });

    it('should handle missing token', async () => {
      (authService.getAccessToken as jest.Mock).mockResolvedValueOnce('');
      const res = await service.updateStatus({ jobRunId, status: JobRunStatus.Completed});
      expect(res.message).toContain('Error while updating the status');
    });

    it('should handle error', async () => {
      (axios.patch as jest.Mock).mockRejectedValueOnce(new Error('fail'));  
      const res = await service.updateStatus({ jobRunId, status: JobRunStatus.Completed});
      expect(logger.error).toHaveBeenCalled();
      expect(res.message).toContain('Error while updating the status');
    });
  });

  describe('generateJobsReport', () => {
    it('should trigger report successfully', async () => {
      (axios.post as jest.Mock).mockResolvedValue({});
      const res = await service.generateJobsReport(jobRunId);
      expect(axios.post).toHaveBeenCalledWith(
        `http://report/api/v1/report/inventory/generate-jobs-report`,
        { jobRunId },
        { headers: { Authorization: `Bearer token` } },
      );
      expect(res).toEqual({ message: 'Triggering generateJobsReport successful for job id: ' + jobRunId });
    });

    it('should handle missing token', async () => {
      (authService.getAccessToken as jest.Mock).mockResolvedValueOnce('');
      const res = await service.generateJobsReport(jobRunId);
      expect(res.message).toContain('Error while Triggering generateJobsReport');
    });

    it('should handle error', async () => {
      (axios.post as jest.Mock).mockRejectedValueOnce(new Error('fail'));
      const res = await service.generateJobsReport(jobRunId);
      expect(logger.error).toHaveBeenCalled();
      expect(res.message).toContain('Error while Triggering generateJobsReport');
    });
  });

  describe('updateJobErrorStatus', () => {
    it('should call updateStatus and updateLastEntry', async () => {
      const spyStatus = jest.spyOn(service, 'updateStatus').mockResolvedValue({ message: 'ok' });
      const spyLast = jest.spyOn(service, 'updateLastEntry').mockResolvedValue({ message: 'ok' });

      await service.updateJobErrorStatus(jobRunId);
      expect(spyStatus).toHaveBeenCalledWith({ jobRunId, status: JobRunStatus.Errored });
      expect(spyLast).toHaveBeenCalledWith(jobRunId);
    });
  });

  describe('get/set JobState', () => {
    it('should get job state', async () => {
      const state = await service.getJobState(traceId);
      expect(state).toEqual({ state: 'OK' });
    });

    it('should set job state', async () => {
      const newState = { workers: [], tasks_completed: 1, tasks_total: 2, status: JobRunStatus.Completed };
      await service.setJobState(traceId, newState as any);
      expect(redisService.setJobContext).toHaveBeenCalledWith(traceId, expect.anything());
    });
  });

  describe('getJobStateWithStreamLoad', () => {
    it('should return state and overload flag', async () => {
      mockContext.getMigrationTaskLength = jest.fn().mockResolvedValue(10);
      const pubSpy = jest.spyOn(service, 'publishPendingTasksToStream').mockResolvedValue(undefined);
      const result = await service.getJobStateWithStreamLoad(traceId, 'SCAN');
      expect(result.jobState).toEqual({ state: 'OK' });
      expect(result.isStreamOverloaded).toBe(true);
      expect(pubSpy).toHaveBeenCalledWith(mockContext, 'SCAN');
    });
  });

  describe('fetchOneTask and fetchOneMigrationTask', () => {
    it('should fetch one task', async () => {
      const task = await service.fetchOneTask(mockContext);
      expect(task).toEqual({ id: 't1' });
    });
    it('should return undefined on error', async () => {
      mockContext.groupReadTasks = jest.fn().mockRejectedValueOnce(new Error('fail'));
      const task = await service.fetchOneTask(mockContext);
      expect(task).toBeUndefined();
    });

    it('should fetch one migration task', async () => {
      const task = await service.fetchOneMigrationTask(mockContext);
      expect(task).toEqual({ id: 'mt1' });
    });
    it('should return undefined on migration error', async () => {
      mockContext.groupReadMigrationTask = jest.fn().mockRejectedValueOnce(new Error('fail'));
      const task = await service.fetchOneMigrationTask(mockContext);
      expect(task).toBeUndefined();
    });
  });

  describe('getJobStateAndUpdateTaskList', () => {
    it('should publish pending and return state', async () => {
      const pubSpy = jest.spyOn(service, 'publishPendingTasksToStream').mockResolvedValue(undefined);
      const state = await service.getJobStateAndUpdateTaskList(traceId, 'SYNC');
      expect(pubSpy).toHaveBeenCalledWith(mockContext, 'SYNC');
      expect(state).toEqual({ state: 'OK' });
    });
  });

  describe('updateWorkerResponse', () => {
    it('should update worker response successfully', async () => {
      (axios.put as jest.Mock).mockResolvedValue({});
      const res = await service.updateWorkerResponse(jobRunId, workerId, { data: 1 });
      expect(res).toEqual({ message: 'Worker response updated successfully for job id: ' + jobRunId });
    });
    it('should handle error', async () => {
      (axios.put as jest.Mock).mockRejectedValueOnce(new Error('fail'));
      const res = await service.updateWorkerResponse(jobRunId, workerId, { data: 1 });
      expect(res.message).toContain('Error while updating the worker response');
    });

    it('should handle missing token when updating worker response', async () => {
      (authService.getAccessToken as jest.Mock).mockResolvedValueOnce('');
      const res = await service.updateWorkerResponse(jobRunId, workerId, { data: 1 });
      expect(res.message).toContain('Error while updating the worker response');
    });
  });

      describe('hasRunningScanTask', () => {
      it('should return false if scan task running is empty', async () => {
      mockContext.isRunningScanTaskEmpty = jest.fn().mockResolvedValue(true);
      const result = await service.hasRunningScanTask(jobRunId);
      expect(redisService.getJobContext).toHaveBeenCalledWith(jobRunId);
      expect(result).toBe(false);
      });
      it('should return true if scan task running is not empty', async () => {
      mockContext.isRunningScanTaskEmpty = jest.fn().mockResolvedValue(false);
      const result = await service.hasRunningScanTask(jobRunId);
      expect(result).toBe(true);
      });
    });

    describe('hasRunningSyncTask', () => {
      it('should return false if sync task running is empty', async () => {
      mockContext.isRunningSyncTaskEmpty = jest.fn().mockResolvedValue(true);
      const result = await service.hasRunningSyncTask(jobRunId);
      expect(redisService.getJobContext).toHaveBeenCalledWith(jobRunId);
      expect(result).toBe(false);
      });
      it('should return true if sync task running is not empty', async () => {
      mockContext.isRunningSyncTaskEmpty = jest.fn().mockResolvedValue(false);
      const result = await service.hasRunningSyncTask(jobRunId);
      expect(result).toBe(true);
      });
    });

    describe('publishPendingTasksToStream', () => {
      it('should append scan tasks to stream and delete all scan tasks', async () => {
      const scanTasks = { t1: JSON.stringify({ id: 't1' }), t2: JSON.stringify({ id: 't2' }) };
      mockContext.getAllRunningScanTasks = jest.fn().mockResolvedValue(scanTasks);
      mockContext.appendToTaskList = jest.fn().mockResolvedValue(undefined);
      mockContext.deleteAllScanTasks = jest.fn().mockResolvedValue(undefined);
      await service.publishPendingTasksToStream(mockContext, 'SCAN');
      expect(mockContext.appendToTaskList).toHaveBeenCalledTimes(2);
      expect(mockContext.deleteAllScanTasks).toHaveBeenCalled();
      });

      it('should append sync tasks to stream and delete all sync tasks', async () => {
      const syncTasks = { s1: JSON.stringify({ id: 's1' }) };
      mockContext.getAllRunningSyncTasks = jest.fn().mockResolvedValue(syncTasks);
      mockContext.appendToMigrationTask = jest.fn().mockResolvedValue(undefined);
      mockContext.deleteAllSyncTasks = jest.fn().mockResolvedValue(undefined);
      await service.publishPendingTasksToStream(mockContext, 'SYNC');
      expect(mockContext.appendToMigrationTask).toHaveBeenCalledTimes(1);
      expect(mockContext.deleteAllSyncTasks).toHaveBeenCalled();
      });

      it('should do nothing if no running scan/sync tasks', async () => {
      mockContext.getAllRunningScanTasks = jest.fn().mockResolvedValue({});
      mockContext.getAllRunningSyncTasks = jest.fn().mockResolvedValue({});
      await service.publishPendingTasksToStream(mockContext, 'SCAN');
      await service.publishPendingTasksToStream(mockContext, 'SYNC');
      expect(mockContext.appendToTaskList).not.toHaveBeenCalled();
      expect(mockContext.appendToMigrationTask).not.toHaveBeenCalled();
      });

      it('should handle errors when appending scan tasks to stream', async () => {
        const scanTasks = { t1: JSON.stringify({ id: 't1' }) };
        mockContext.getAllRunningScanTasks = jest.fn().mockResolvedValue(scanTasks);
        mockContext.appendToTaskList = jest.fn().mockRejectedValueOnce(new Error('append error'));
        mockContext.deleteAllScanTasks = jest.fn().mockResolvedValue(undefined);
        await service.publishPendingTasksToStream(mockContext, 'SCAN');
        expect(logger.error).toHaveBeenCalledWith(
          `[${mockContext.jobRunId}] Failed to append Scan task to stream: Error: append error`
        );
        expect(mockContext.deleteAllScanTasks).toHaveBeenCalled();
      });

      it('should handle errors when appending sync tasks to stream', async () => {
        const syncTasks = { s1: JSON.stringify({ id: 's1' }) };
        mockContext.getAllRunningSyncTasks = jest.fn().mockResolvedValue(syncTasks);
        mockContext.appendToMigrationTask = jest.fn().mockRejectedValueOnce(new Error('sync error'));
        mockContext.deleteAllSyncTasks = jest.fn().mockResolvedValue(undefined);
        await service.publishPendingTasksToStream(mockContext, 'SYNC');
        expect(logger.error).toHaveBeenCalledWith(
          `[${mockContext.jobRunId}] Failed to append Sync task to stream: Error: sync error`
        );
        expect(mockContext.deleteAllSyncTasks).toHaveBeenCalled();
      });

      describe('updateLastEntry', () => {
        it('should publish last entries successfully', async () => {
          const jobManagerContext = {
        publishToFileStream: jest.fn().mockResolvedValue(undefined),
        publishToTaskStream: jest.fn().mockResolvedValue(undefined),
        publishToErrorStream: jest.fn().mockResolvedValue(undefined),
          };
          redisService.getJobManagerContext = jest.fn().mockResolvedValue(jobManagerContext);
          const res = await service.updateLastEntry(traceId);
          expect(redisService.getJobManagerContext).toHaveBeenCalledWith(traceId);
          expect(jobManagerContext.publishToFileStream).toHaveBeenCalled();
          expect(jobManagerContext.publishToTaskStream).toHaveBeenCalled();
          expect(jobManagerContext.publishToErrorStream).toHaveBeenCalled();
          expect(res).toEqual({ message: 'Job completed for job id: ' + traceId });
        });

        it('should handle error when publishing last entry', async () => {
          redisService.getJobManagerContext = jest.fn().mockRejectedValueOnce(new Error('fail'));
          const res = await service.updateLastEntry(traceId);
          expect(logger.error).toHaveBeenCalled();
          expect(res).toEqual({ message: 'Error while marking the job as completed : ' + traceId });
        });

        it('should handle error when cleaning up job context', async () => {
          redisService.getJobManagerContext = jest.fn().mockRejectedValueOnce(new Error('fail'));
          const res = await service.cleanupJobContext(traceId);
          expect(logger.error).toHaveBeenCalledWith(
            `[${traceId}] Error while cleaning up the job context: Error: fail`
          );
          expect(res).toEqual({ message: 'Error while cleaning up the job context: ' + traceId });
        });

        it('should cleanup job context successfully', async () => {
          const jobManagerContext = { cleanup: jest.fn().mockResolvedValue(undefined) };
          redisService.getJobManagerContext = jest.fn().mockResolvedValue(jobManagerContext);
          const res = await service.cleanupJobContext(traceId);
          expect(jobManagerContext.cleanup).toHaveBeenCalled();
          expect(res).toBeUndefined();
        });
      });
    });

});