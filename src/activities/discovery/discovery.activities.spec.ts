import { DiscoveryActivity } from './discovery.activities';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';
import { CommonActivityService } from '../common/common.service';
import axios from 'axios';

jest.mock('axios');

describe('DiscoveryActivity', () => {
  let discoveryActivity: DiscoveryActivity;
  let mockConfigService: Partial<ConfigService>;
  let mockLogger: Partial<Logger>;
  let mockRedisService: Partial<RedisService>;
  let mockCommonService: Partial<CommonActivityService>;

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'worker.workerId') return 'worker-1';
        if (key === 'worker.workerReportServiceUrl') return 'http://report-service';
      }),
    };

    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
    };

    mockRedisService = {
      getJobContext: jest.fn().mockResolvedValue({
        groupReadTasks: jest.fn().mockResolvedValue([]),
        groupReadDirs: jest.fn().mockResolvedValue([]),
        appendToTaskList: jest.fn().mockResolvedValue('task-id'),
        appendToFileList: jest.fn().mockResolvedValue('file-id'),
        tasksInfo: { lastId: null },
        errorsInfo: { lastId: null },
      }),
      setJobContext: jest.fn(),
    };

    mockCommonService = {
      getJobState: jest.fn().mockResolvedValue({ tasks_total: 0 }),
    };

    discoveryActivity = new DiscoveryActivity(
      mockConfigService as ConfigService,
      mockLogger as Logger,
      mockRedisService as RedisService,
      mockCommonService as CommonActivityService
    );
  });

  it('should return worker ID', async () => {
    const workerId = await discoveryActivity.getWorkerId();
    expect(workerId).toBe('worker-1');
  });

  it('should fetch tasks successfully', async () => {
    const traceId = 'trace-123';
    const tasks = await discoveryActivity.fetchTasks(traceId);
    expect(tasks).toEqual([]);
    expect(mockLogger.log).toHaveBeenCalledWith(`[${traceId}] Fetched 0 tasks.`);
  });

  it('should handle errors when fetching tasks', async () => {
    const traceId = 'trace-123';
    mockRedisService.getJobContext = jest.fn().mockRejectedValue(new Error('Redis error'));
    const tasks = await discoveryActivity.fetchTasks(traceId);
    expect(tasks).toEqual([]);
    expect(mockLogger.error).toHaveBeenCalledWith(`[${traceId}] Failed to fetch the task: Error: Redis error`);
  });


  it('should handle errors when publishing tasks', async () => {
    const traceId = 'trace-123';
    mockRedisService.getJobContext = jest.fn().mockRejectedValue(new Error('Redis error'));
    const result = await discoveryActivity.publishTask(traceId);
    expect(result).toEqual({
      traceId: traceId,
      status: 'error',
      message: `Failed to publish task for Job run id ${traceId} : Error: Redis error`,
    });
    expect(mockLogger.error).toHaveBeenCalledWith(`[${traceId}] Error in publishing task: Redis error`);
  });


  it('should handle errors when updating discovery status', async () => {
    const traceId = 'trace-123';
    const status = 'completed';
    (axios.patch as jest.Mock).mockRejectedValue(new Error('Axios error'));
    const result = await discoveryActivity.discoveryStatusUpdate(traceId, status);
    expect(result).toEqual({ message: 'Error while updating the satus of the job id : ' + traceId });
    expect(mockLogger.error).toHaveBeenCalledWith(`[${traceId}] Failed to update discovery status: TypeError: Cannot read properties of undefined (reading 'get')`);
  });

  it('should publish last entry successfully', async () => {
    const traceId = 'trace-123';
    const result = await discoveryActivity.publishLastEntry(traceId);
    expect(result).toEqual({ message: 'Discovery Job completed for job id: ' + traceId });
    expect(mockLogger.log).toHaveBeenCalledWith(`[${traceId}] Last entry published for job id: ${traceId}`);
  });

  it('should handle errors when publishing last entry', async () => {
    const traceId = 'trace-123';
    mockRedisService.getJobContext = jest.fn().mockRejectedValue(new Error('Redis error'));
    const result = await discoveryActivity.publishLastEntry(traceId);
    expect(result).toEqual({ message: 'Error while marking the job as completed : ' + traceId });
    expect(mockLogger.error).toHaveBeenCalledWith(`[${traceId}] Error while marking the job as completed : Error: Redis error`);
  });

  it('should generate discovery report successfully', async () => {
    const jobRunId = 'job-123';
    (axios.post as jest.Mock).mockResolvedValue({});
    const result = await discoveryActivity.generateDiscoveryReport(jobRunId);
    expect(result).toEqual({ message: 'Trigger generateDiscoveryReport Successful for job id: ' + jobRunId });
    expect(mockLogger.log).toHaveBeenCalledWith(`[${jobRunId}] Trigger generateDiscoveryReport Successful`);
  });

  it('should handle errors when generating discovery report', async () => {
    const jobRunId = 'job-123';
    (axios.post as jest.Mock).mockRejectedValue(new Error('Axios error'));
    const result = await discoveryActivity.generateDiscoveryReport(jobRunId);
    expect(result).toEqual({ message: 'Error while Trigger generateDiscoveryReport the status of the job id : ' + jobRunId });
    expect(mockLogger.error).toHaveBeenCalledWith(`[${jobRunId}] Failed to Trigger generateDiscoveryReport: Error: Axios error`);
  });
});
 