import { Test, TestingModule } from '@nestjs/testing';

import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { AuthService } from 'src/auth/auth.service';
import { RedisService } from 'src/redis/redis.service';
import axios from 'axios';
import { JobRunStatus, CutOverStatus } from './enums';
import { JobContext, JobType } from '@netapp-cloud-datamigrate/jobs-lib';
import { CommonActivityService } from './common.service';
import {
  LoggerFactory,
  LoggerService
} from '@netapp-cloud-datamigrate/logger-lib';
import { mockLogger } from 'src/auth/auth.service.spec';
import { SmbUserSetupService } from '../core/migrate/command-execution/smb-user-setup.service';

jest.mock('axios');

describe('CommonActivityService', () => {
  let service: CommonActivityService;
  let configService: Partial<ConfigService>;
  let httpService: Partial<HttpService>;
  let authService: Partial<AuthService>;
  let logger: Partial<LoggerService>;
  let redisService: Partial<RedisService>;
  let smbUserSetupService: Partial<SmbUserSetupService>;
  let mockContext: any;

  const traceId = 'test-trace';
  const jobRunId = 'job123';
  const workerId = 'worker1';

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();
    
    mockContext = {
      cleanup: jest.fn(),
      publishToFileStream: jest.fn(),
      publishToTaskStream: jest.fn(),
      publishToErrorStream: jest.fn(),
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
      jobConfig: {
        jobType: JobType.MIGRATION,
        destinationFileServer: {
          username: 'testuser'
        }
      }
    } as unknown as JobContext;

    configService = {
      get: jest.fn((key: string) => {
        const map = {
          'worker.workerId': workerId,
          'worker.connection.workerJobServiceUrl': 'http://job',
          'worker.connection.workerReportServiceUrl': 'http://report',
          'worker.migrationTaskStreamLimit': 5,
          'worker.maxRetryCount': 3,
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
      getJobManagerContext: jest.fn().mockResolvedValue(mockContext),
      setJobContext: jest.fn(),
    };

    smbUserSetupService = {
      removePrincipals: jest.fn().mockResolvedValue(undefined),
      setup: jest.fn().mockResolvedValue(undefined),
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
        { provide: SmbUserSetupService, useValue: smbUserSetupService },
      ],
    }).compile();

    service = module.get<CommonActivityService>(CommonActivityService);
  });

  describe('constructor', () => {
    it('should initialize with correct default values', () => {
      expect(service.workerId).toBe(workerId);
      expect(service.workerJobServiceUrl).toBe('http://job');
      expect(service.reportServiceUrl).toBe('http://report');
      expect(service.migrationTaskLimit).toBe(5);
      expect(service.maxRetryCount).toBe(3);
      expect(service.fetchTaskBatch).toBe(50);
      expect(service.pushTaskDirSize).toBe(500);
    });

    it('should use default maxRetryCount when not provided in config', () => {
      // This tests the || 3 fallback in the constructor
      expect(service.maxRetryCount).toBe(3);
    });
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
      
      await expect(service.updateStatus({ jobRunId, status: JobRunStatus.Completed }))
        .rejects.toThrow('Error while updating the status of the job id : job123');
      
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle error', async () => {
      (axios.patch as jest.Mock).mockRejectedValueOnce(new Error('fail'));  
      
      await expect(service.updateStatus({ jobRunId, status: JobRunStatus.Completed }))
        .rejects.toThrow('Error while updating the status of the job id : job123');
      
      expect(logger.error).toHaveBeenCalled();
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
      
      await expect(service.generateJobsReport(jobRunId))
        .rejects.toThrow('Error while Triggering generateJobsReport for the job id : job123');
      
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle error', async () => {
      (axios.post as jest.Mock).mockRejectedValueOnce(new Error('fail'));
      
      await expect(service.generateJobsReport(jobRunId))
        .rejects.toThrow('Error while Triggering generateJobsReport for the job id : job123');
      
      expect(logger.error).toHaveBeenCalled();
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

    it('should propagate errors from updateStatus', async () => {
      jest.spyOn(service, 'updateStatus').mockRejectedValue(new Error('Status update failed'));
      
      await expect(service.updateJobErrorStatus(jobRunId))
        .rejects.toThrow('Status update failed');
    });

    it('should propagate errors from updateLastEntry', async () => {
      jest.spyOn(service, 'updateStatus').mockResolvedValue({ message: 'ok' });
      jest.spyOn(service, 'updateLastEntry').mockRejectedValue(new Error('Last entry failed'));
      
      await expect(service.updateJobErrorStatus(jobRunId))
        .rejects.toThrow('Last entry failed');
    });
  });

  describe('updateLastEntry', () => {
    it('should update last entry successfully', async () => {
      const res = await service.updateLastEntry(traceId);
      
      expect(redisService.getJobManagerContext).toHaveBeenCalledWith(traceId);
      expect(mockContext.publishToFileStream).toHaveBeenCalled();
      expect(mockContext.publishToTaskStream).toHaveBeenCalled();
      expect(mockContext.publishToErrorStream).toHaveBeenCalled();
      expect(res).toEqual({ message: 'Job completed for job id: ' + traceId });
    });

    it('should throw error when Redis operations fail', async () => {
      const error = new Error('Redis connection failed');
      (redisService.getJobManagerContext as jest.Mock).mockRejectedValueOnce(error);
      
      await expect(service.updateLastEntry(traceId))
        .rejects.toThrow('Error while marking the job as completed : test-trace');
      
      expect(logger.error).toHaveBeenCalled();
    });


    it('should skip SMB user setup removal for discovery jobs on Windows', async () => {
      // Mock Windows platform
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', {
        value: 'win32'
      });

      mockContext.jobConfig = {
        jobType: JobType.DISCOVERY,
        destinationFileServer: {
          username: 'testuser'
        }
      };

      await service.updateLastEntry(traceId);

      expect(smbUserSetupService.removePrincipals).not.toHaveBeenCalled();

      // Restore original platform
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform);
      }
    });

    it('should skip SMB user setup removal on non-Windows platforms', async () => {
      // Mock non-Windows platform
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', {
        value: 'linux'
      });

      await service.updateLastEntry(traceId);

      expect(smbUserSetupService.removePrincipals).not.toHaveBeenCalled();

      // Restore original platform
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform);
      }
    });

   
    it('should handle missing job config gracefully', async () => {
      // Mock Windows platform
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', {
        value: 'win32'
      });

      mockContext.jobConfig = null;

      await service.updateLastEntry(traceId);

      expect(smbUserSetupService.removePrincipals).not.toHaveBeenCalled();
      expect(mockContext.publishToFileStream).toHaveBeenCalled();

      // Restore original platform
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform);
      }
    });
  });

  describe('generateCOCReport', () => {
    it('should trigger COC report successfully', async () => {
      (axios.get as jest.Mock).mockResolvedValue({});
      const res = await service.generateCOCReport(jobRunId);
      
      expect(axios.get).toHaveBeenCalledWith(
        `http://report/api/v1/report/job-run/coc-report/${jobRunId}`,
        { headers: { Authorization: `Bearer token` } },
      );
      expect(res).toEqual({ message: 'Triggering generateCOCReport successful for job id: ' + jobRunId });
    });

    it('should throw error for missing token', async () => {
      (authService.getAccessToken as jest.Mock).mockResolvedValueOnce('');
      
      await expect(service.generateCOCReport(jobRunId))
        .rejects.toThrow('Error while Triggering generateCOCReport for the job id : job123');
    });

    it('should throw error for request failure', async () => {
      (axios.get as jest.Mock).mockRejectedValueOnce(new Error('Request failed'));
      
      await expect(service.generateCOCReport(jobRunId))
        .rejects.toThrow('Error while Triggering generateCOCReport for the job id : job123');
      
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('generateDiscoveryReport', () => {
    it('should trigger discovery report successfully', async () => {
      (axios.post as jest.Mock).mockResolvedValue({});
      const res = await service.generateDiscoveryReport(jobRunId);
      
      expect(axios.post).toHaveBeenCalledWith(
        `http://report/api/v1/report/inventory/generate-report`,
        { jobRunId: jobRunId, "report-type": "DISCOVER" },
        { headers: { Authorization: `Bearer token` } },
      );
      expect(res).toEqual({ message: 'Trigger generateDiscoveryReport Successful for job id: ' + jobRunId });
    });

    it('should throw error for missing token', async () => {
      (authService.getAccessToken as jest.Mock).mockResolvedValueOnce('');
      
      await expect(service.generateDiscoveryReport(jobRunId))
        .rejects.toThrow('Error while Trigger generateDiscoveryReport the status of the job id : job123');
    });

    it('should throw error for request failure', async () => {
      (axios.post as jest.Mock).mockRejectedValueOnce(new Error('Service unavailable'));
      
      await expect(service.generateDiscoveryReport(jobRunId))
        .rejects.toThrow('Error while Trigger generateDiscoveryReport the status of the job id : job123');
      
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('cleanupJobContext', () => {
    it('should cleanup job context successfully', async () => {
      await service.cleanupJobContext(traceId);
      
      expect(redisService.getJobManagerContext).toHaveBeenCalledWith(traceId);
      expect(mockContext.cleanup).toHaveBeenCalled();
    });

    it('should throw error when cleanup fails', async () => {
      const error = new Error('Cleanup failed');
      mockContext.cleanup.mockRejectedValueOnce(error);
      
      await expect(service.cleanupJobContext(traceId))
        .rejects.toThrow('Error while cleaning up the job context: test-trace');
      
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('updateCutOverStatus', () => {
    it('should update cutover status successfully', async () => {
      (axios.put as jest.Mock).mockResolvedValue({});
      const res = await service.updateCutOverStatus({ jobRunId, status: CutOverStatus.APPROVED});
      
      expect(authService.getAccessToken).toHaveBeenCalled();
      expect(axios.put).toHaveBeenCalledWith(
        `http://job/api/v1/job-run/cutover/${jobRunId}/APPROVED`,
        {},
        { headers: { Authorization: `Bearer token` } },
      );
      expect(res).toEqual({ message: 'Job status updated for job id: ' + jobRunId });
    });

    it('should throw error for missing token', async () => {
      (authService.getAccessToken as jest.Mock).mockResolvedValueOnce('');
      
      await expect(service.updateCutOverStatus({ jobRunId, status: CutOverStatus.APPROVED }))
        .rejects.toThrow('Error while updating the status of the job id : job123');
      
      expect(logger.error).toHaveBeenCalled();
    });

    it('should throw error for request failure', async () => {
      (axios.put as jest.Mock).mockRejectedValueOnce(new Error('fail'));
      
      await expect(service.updateCutOverStatus({ jobRunId, status: CutOverStatus.REJECTED }))
        .rejects.toThrow('Error while updating the status of the job id : job123');
      
      expect(logger.error).toHaveBeenCalled();
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
      
      await expect(service.updateWorkerResponse(jobRunId, workerId, { data: 1 }))
        .rejects.toThrow('Error while updating the worker response for the job id : job123');
      
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle missing token when updating worker response', async () => {
      (authService.getAccessToken as jest.Mock).mockResolvedValueOnce('');
      
      await expect(service.updateWorkerResponse(jobRunId, workerId, { data: 1 }))
        .rejects.toThrow('Error while updating the worker response for the job id : job123');
      
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle null token when updating worker response', async () => {
      (authService.getAccessToken as jest.Mock).mockResolvedValueOnce(null);
      
      await expect(service.updateWorkerResponse(jobRunId, workerId, { data: 1 }))
        .rejects.toThrow('Error while updating the worker response for the job id : job123');
      
      expect(logger.error).toHaveBeenCalled();
    });

    it('should make correct API call with proper parameters', async () => {
      (axios.put as jest.Mock).mockResolvedValue({});
      const workerResponse = { status: 'completed', data: { files: 100 } };
      
      await service.updateWorkerResponse(jobRunId, workerId, workerResponse);
      
      expect(axios.put).toHaveBeenCalledWith(
        `http://job/api/v1/job-run/worker-response/${jobRunId}/${workerId}`,
        workerResponse,
        { headers: { Authorization: 'Bearer token' } }
      );
    });
  });

  describe('Configuration scenarios', () => {
    it('should handle missing config values gracefully', async () => {
      // Test with a service that has missing config values
      const configServiceWithMissing = {
        get: jest.fn((key: string) => {
          const map = {
            'worker.workerId': undefined,
            'worker.connection.workerJobServiceUrl': undefined,
            'worker.connection.workerReportServiceUrl': undefined,
            'worker.migrationTaskStreamLimit': undefined,
            'worker.maxRetryCount': undefined,
          };
          return map[key];
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CommonActivityService,
          { provide: ConfigService, useValue: configServiceWithMissing },
          { provide: HttpService, useValue: httpService },
          { provide: AuthService, useValue: authService },
          { provide: LoggerFactory, useValue: { create: jest.fn().mockReturnValue(mockLogger) } },
          { provide: RedisService, useValue: redisService },
          { provide: SmbUserSetupService, useValue: smbUserSetupService },
        ],
      }).compile();

      const serviceWithMissingConfig = module.get<CommonActivityService>(CommonActivityService);
      
      expect(serviceWithMissingConfig.workerId).toBeUndefined();
      expect(serviceWithMissingConfig.workerJobServiceUrl).toBeUndefined();
      expect(serviceWithMissingConfig.reportServiceUrl).toBeUndefined();
      expect(serviceWithMissingConfig.migrationTaskLimit).toBeUndefined();
      expect(serviceWithMissingConfig.maxRetryCount).toBe(3); // Should use default fallback
    });
  });

  describe('Error handling edge cases', () => {
    it('should handle axios errors with detailed error messages', async () => {
      const detailedError = {
        message: 'Network error',
        response: {
          status: 500,
          data: { error: 'Internal server error' }
        }
      };
      (axios.patch as jest.Mock).mockRejectedValueOnce(detailedError);
      
      await expect(service.updateStatus({ jobRunId, status: JobRunStatus.Completed }))
        .rejects.toThrow('Error while updating the status of the job id : job123');
      
      expect(logger.error).toHaveBeenCalledWith(`[${jobRunId}] Failed to update status: ${detailedError}`);
    });

    it('should handle timeout errors for generateJobsReport', async () => {
      const timeoutError = new Error('Request timeout');
      timeoutError.name = 'TIMEOUT';
      (axios.post as jest.Mock).mockRejectedValueOnce(timeoutError);
      
      await expect(service.generateJobsReport(jobRunId))
        .rejects.toThrow('Error while Triggering generateJobsReport for the job id : job123');
      
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle network errors for generateCOCReport', async () => {
      const networkError = new Error('Network unreachable');
      networkError.name = 'NETWORK_ERROR';
      (axios.get as jest.Mock).mockRejectedValueOnce(networkError);
      
      await expect(service.generateCOCReport(jobRunId))
        .rejects.toThrow('Error while Triggering generateCOCReport for the job id : job123');
      
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to Trigger generateCOCReport'));
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete workflow with updateJobErrorStatus', async () => {
      const updateStatusSpy = jest.spyOn(service, 'updateStatus').mockResolvedValue({ message: 'ok' });
      const updateLastEntrySpy = jest.spyOn(service, 'updateLastEntry').mockResolvedValue({ message: 'ok' });

      await service.updateJobErrorStatus(jobRunId);
      
      expect(updateStatusSpy).toHaveBeenCalledWith({ jobRunId, status: JobRunStatus.Errored });
      expect(updateLastEntrySpy).toHaveBeenCalledWith(jobRunId);
      
      // Both methods should have been called
      expect(updateStatusSpy).toHaveBeenCalledTimes(1);
      expect(updateLastEntrySpy).toHaveBeenCalledTimes(1);
    });

    it('should properly clean up resources in cleanupJobContext', async () => {
      await service.cleanupJobContext(traceId);
      
      expect(redisService.getJobManagerContext).toHaveBeenCalledWith(traceId);
      expect(mockContext.cleanup).toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('should handle cleanup failures with detailed error logging', async () => {
      const cleanupError = new Error('Failed to cleanup Redis streams');
      mockContext.cleanup.mockRejectedValueOnce(cleanupError);
      
      await expect(service.cleanupJobContext(traceId))
        .rejects.toThrow('Error while cleaning up the job context: test-trace');
      
      expect(logger.error).toHaveBeenCalledWith(`[${traceId}] Error while cleaning up the job context: ${cleanupError}`);
    });
  });

});