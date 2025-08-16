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

  

});