import { Test, TestingModule } from '@nestjs/testing';

import { HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { of, throwError } from 'rxjs';
import { RedisService } from 'src/redis/redis.service';
import { CommonActivityService } from '../common/common.service';
import { getAccessToken } from '../common/token.util';
import { DiscoveryActivity } from './discovery.activities';


jest.mock('src/config/app.config', () => ({
  WorkersConfig: {
    get: jest.fn((key: string) => {
      if (key === 'workerJobServiceUrl') {
        return 'http://job-service';
      }
      return null;
    }),
  },
}));


jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;


jest.mock('../common/token.util', () => ({
  getAccessToken: jest.fn(),
}));

describe('DiscoveryActivity', () => {
  let service: DiscoveryActivity;
  let configService: Partial<ConfigService>;
  let httpService: Partial<HttpService>;
  let logger: Partial<Logger>;
  let redisService: Partial<RedisService>;
  let commonService: Partial<CommonActivityService>;

  beforeEach(async () => {
    configService = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'worker.workerId':
            return 'test-worker';
          case 'worker.workerReportServiceUrl':
            return 'http://report-service';
          case 'keycloak':
            return { baseUrl: 'http://keycloak', realm: 'testrealm', workerSecret: 'secret' };
          default:
            return null;
        }
      }),
    };

    httpService = {
      post: jest.fn(),
    };

    logger = {
      log: jest.fn(),
      error: jest.fn(),
    };

    redisService = {
      getJobContext: jest.fn(),
    };

    commonService = {
      getJobState: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscoveryActivity,
        { provide: ConfigService, useValue: configService },
        { provide: HttpService, useValue: httpService },
        { provide: Logger, useValue: logger },
        { provide: RedisService, useValue: redisService },
        { provide: CommonActivityService, useValue: commonService },
      ],
    }).compile();

    service = module.get<DiscoveryActivity>(DiscoveryActivity);
  });

  describe('getAccessToken', () => {
    it('should fetch and cache a new access token on success', async () => {
      const now = Math.floor(Date.now() / 1000);
      const tokenResponse = { data: { access_token: 'token123', expires_in: 100 } };
      (httpService.post as jest.Mock).mockReturnValue(of(tokenResponse));


      const token = await service.getAccessToken();
      expect(token).toBe('token123');
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Fetched new access token'));

      const token2 = await service.getAccessToken();
      expect(token2).toBe('token123');
      expect(httpService.post).toHaveBeenCalledTimes(1);
    });

    it('should return null on error fetching token', async () => {
      (httpService.post as jest.Mock).mockReturnValue(throwError(() => new Error('Fetch error')));
      const token = await service.getAccessToken();
      expect(token).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to obtain access token'));
    });
  });

  describe('getWorkerId', () => {
    it('should return workerId', async () => {
      const id = await service.getWorkerId();
      expect(id).toBe('test-worker');
    });
  });

  describe('fetchTasks', () => {
    it('should return tasks from job context', async () => {
      const fakeTasks = [{ id: 'task1' }, { id: 'task2' }];
      const asyncTaskIterator = {
        async *[Symbol.asyncIterator]() {
          for (const task of fakeTasks) {
            yield task;
          }
        },
      };
      const fakeJobContext = {
        groupReadTasks: jest.fn().mockResolvedValue(asyncTaskIterator),
      };
      (redisService.getJobContext as jest.Mock).mockResolvedValue(fakeJobContext);

      const tasks = await service.fetchTasks('trace-1');
      expect(tasks).toEqual(fakeTasks);
      expect(logger.log).toHaveBeenCalledWith('[trace-1] Fetched 2 tasks.');
    });

    it('should return an empty array on error', async () => {
      (redisService.getJobContext as jest.Mock).mockRejectedValue(new Error('fail'));
      const tasks = await service.fetchTasks('trace-1');
      expect(tasks).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to fetch the task'));
    });
  });

  describe('publishTask', () => {
    it('should publish tasks when directory batch is reached', async () => {
      const fakeDirs = [{ path: '/dir1' }, { path: '/dir2' }];
      const asyncDirIterator = {
        async *[Symbol.asyncIterator]() {
          for (const dir of fakeDirs) {
            yield dir;
          }
        },
      };

      const fakeJobContext = {
        groupReadDirs: jest.fn().mockResolvedValue(asyncDirIterator),
        appendToTaskList: jest.fn().mockResolvedValue('lastTaskId'),
        tasksInfo: {},
        jobState: { tasks_total: 0, workers: [], tasks_completed: 0, workers_agreed: [], status: 'in-progress' },
      };
      (redisService.getJobContext as jest.Mock).mockResolvedValue(fakeJobContext);
      (commonService.getJobState as jest.Mock).mockResolvedValue({ tasks_total: 0, workers: [], tasks_completed: 0, workers_agreed: [], status: 'in-progress' });

      const result = await service.publishTask('trace-1');
      expect(result).toBeDefined();
    });

    it('should handle errors during publishTask', async () => {
      (redisService.getJobContext as jest.Mock).mockRejectedValue(new Error('publish error'));
      const result = await service.publishTask('trace-1');
      expect(result.status).toBe('error');
      expect(result.message).toContain('publish error');
    });
  });

  describe('discoveryStatusUpdate', () => {
    it('should update discovery status successfully', async () => {
      jest.spyOn(service, 'getAccessToken').mockResolvedValue('token123');
      mockedAxios.patch.mockResolvedValue({});

      const result = await service.discoveryStatusUpdate('trace-1', 'COMPLETED');
      expect(result).toEqual({ message: 'Discovery Job status updated as completed for job id: trace-1' });
      expect(mockedAxios.patch).toHaveBeenCalledWith(
        'http://job-service/trace-1/COMPLETED',
        { headers: { Authorization: 'Bearer token123' } }
      );
      expect(logger.log).toHaveBeenCalledWith('[trace-1] Discovery status updated to COMPLETED');
    });

    it('should return error when access token is null', async () => {
      jest.spyOn(service, 'getAccessToken').mockResolvedValue(null);
      const result = await service.discoveryStatusUpdate('trace-1', 'FAILED');
      expect(result).toEqual({ message: 'Error while updating the satus of the job id : trace-1' });
    });

    it('should handle axios.patch error in discoveryStatusUpdate', async () => {
      jest.spyOn(service, 'getAccessToken').mockResolvedValue('token123');
      mockedAxios.patch.mockRejectedValue(new Error('patch error'));
      const result = await service.discoveryStatusUpdate('trace-1', 'FAILED');
      expect(result).toEqual({ message: 'Error while updating the satus of the job id : trace-1' });
    });
  });

  describe('publishLastEntry', () => {
    it('should publish the last entry successfully', async () => {
      const fakeJobContext = {
        appendToFileList: jest.fn().mockResolvedValue('fileId'),
        errorsInfo: {},
      };
      (redisService.getJobContext as jest.Mock).mockResolvedValue(fakeJobContext);
      const result = await service.publishLastEntry('trace-1');
      expect(result).toBeDefined();
      expect(fakeJobContext.appendToFileList).toHaveBeenCalled();

    });

    it('should handle errors during publishLastEntry', async () => {
      (redisService.getJobContext as jest.Mock).mockRejectedValue(new Error('last entry error'));
      const result = await service.publishLastEntry('trace-1');
      expect(result.message).toContain('Error while marking the job as completed : trace-1');
    });
  });

  describe('generateDiscoveryReport', () => {
    it('should trigger generateDiscoveryReport successfully', async () => {
      (getAccessToken as jest.Mock).mockResolvedValue('token123');
      mockedAxios.post.mockResolvedValue({});

      const result = await service.generateDiscoveryReport('job-1');
      expect(result).toEqual({ message: 'Trigger generateDiscoveryReport Successful for job id: job-1' });
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://report-service/api/v1/report/inventory/generate-report',
        { jobRunId: 'job-1', 'report-type': 'DISCOVER' },
        { headers: { Authorization: 'Bearer token123' } },
      );
      expect(logger.log).toHaveBeenCalledWith('[job-1] Trigger generateDiscoveryReport Successful');
    });

    it('should return error when token is not obtained in generateDiscoveryReport', async () => {
      (getAccessToken as jest.Mock).mockResolvedValue(null);
      const result = await service.generateDiscoveryReport('job-1');
      expect(result.message).toContain('Error while Trigger generateDiscoveryReport the status of the job id : job-1');
    });

    it('should handle axios.post error in generateDiscoveryReport', async () => {
      (getAccessToken as jest.Mock).mockResolvedValue('token123');
      mockedAxios.post.mockRejectedValue(new Error('post error'));
      const result = await service.generateDiscoveryReport('job-1');
      expect(result.message).toContain('Error while Trigger generateDiscoveryReport the status of the job id : job-1');
    });
  });
});
