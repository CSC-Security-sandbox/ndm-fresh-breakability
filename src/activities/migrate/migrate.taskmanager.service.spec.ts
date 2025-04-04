import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { RedisService } from 'src/redis/redis.service';
import { getAccessToken } from '../common/token.util';
import { MigrationTaskService } from './migrate.taskmanager.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock('../common/token.util', () => ({
  getAccessToken: jest.fn(),
}));

describe('MigrationTaskService', () => {
  let service: MigrationTaskService;
  let configService: Partial<ConfigService>;
  let logger: Partial<Logger>;
  let redisService: Partial<RedisService>;
  let httpService: Partial<HttpService>;

  beforeEach(async () => {
    configService = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'worker.workerId':
            return 'test-worker';
          case 'worker.workerJobServiceUrl':
            return 'http://job-service';
          case 'worker.workerReportServiceUrl':
            return 'http://report-service';
          case 'worker.fetchTaskBatchMigration':
            return 2;
          case 'worker.scanTaskDirBatch':
            return 2;
          default:
            return null;
        }
      }),
    };

    logger = {
      log: jest.fn(),
      error: jest.fn(),
    };

    redisService = {
      getJobContext: jest.fn(),
    };

    httpService = {
      // You can add more methods if needed
      post: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MigrationTaskService,
        { provide: ConfigService, useValue: configService },
        { provide: Logger, useValue: logger },
        { provide: RedisService, useValue: redisService },
        { provide: HttpService, useValue: httpService },
      ],
    }).compile();

    service = module.get<MigrationTaskService>(MigrationTaskService);
    jest.clearAllMocks();
  });

  describe('publishScanTask', () => {
    it('should publish tasks successfully when commands batch is less than scanTaskDirBatch', async () => {

      const fakeDirs = [{ path: '/dir1' }];
      const asyncDirIterator = {
        async *[Symbol.asyncIterator]() {
          for (const d of fakeDirs) {
            yield d;
          }
        },
      };

      const fakeJobContext = {
        groupReadDirs: jest.fn().mockResolvedValue(asyncDirIterator),
        appendToTaskList: jest.fn().mockResolvedValue('lastTaskId'),
        tasksInfo: {},
      };
      (redisService.getJobContext as jest.Mock).mockResolvedValue(fakeJobContext);

      const result = await service.publishScanTask({ jobRunId: 'job-1' });
      expect(result).toBeDefined();
    });

    it('should publish tasks successfully when commands batch reaches scanTaskDirBatch', async () => {
      const fakeDirs = [{ path: '/dir1' }, { path: '/dir2' }];
      const asyncDirIterator = {
        async *[Symbol.asyncIterator]() {
          for (const d of fakeDirs) {
            yield d;
          }
        },
      };

      const fakeJobContext = {
        groupReadDirs: jest.fn().mockResolvedValue(asyncDirIterator),
        appendToTaskList: jest.fn().mockResolvedValue('lastTaskId'),
        tasksInfo: {},
      };
      (redisService.getJobContext as jest.Mock).mockResolvedValue(fakeJobContext);

      const result = await service.publishScanTask({ jobRunId: 'job-2' });
      expect(result).toBeDefined();
    });

    it('should handle errors during publishScanTask', async () => {
      (redisService.getJobContext as jest.Mock).mockRejectedValue(new Error('publish error'));
      const result = await service.publishScanTask({ jobRunId: 'job-3' });
      expect(result.status).toBe('error');
      expect(result.message).toContain('publish error');
      expect(logger.error).toHaveBeenCalledWith('[job-3] Error in publishing task: publish error');
    });
  });

  describe('fetchScanTask', () => {
    it('should fetch scan tasks successfully', async () => {
      const fakeTasks = [{ id: 'task1' }, { id: 'task2' }];
      const asyncTaskIterator = {
        async *[Symbol.asyncIterator]() {
          for (const t of fakeTasks) {
            yield t;
          }
        },
      };
      const fakeJobContext = {
        groupReadTasks: jest.fn().mockResolvedValue(asyncTaskIterator),
      };
      (redisService.getJobContext as jest.Mock).mockResolvedValue(fakeJobContext);

      const result = await service.fetchScanTask({ jobRunId: 'job-4' });
      expect(result.tasks).toEqual(fakeTasks);
    });

    it('should return an empty tasks array on error in fetchScanTask', async () => {
      (redisService.getJobContext as jest.Mock).mockRejectedValue(new Error('fetch error'));
      const result = await service.fetchScanTask({ jobRunId: 'job-4' });
      expect(result.tasks).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith('[job-4] Failed to fetch the task: Error: fetch error');
    });
  });

  describe('fetchMigrationTask', () => {
    it('should fetch migration tasks successfully', async () => {
      const fakeTasks = [{ id: 'migTask1' }];
      const asyncTaskIterator = {
        async *[Symbol.asyncIterator]() {
          for (const t of fakeTasks) {
            yield t;
          }
        },
      };
      const fakeJobContext = {
        groupReadMigrationTask: jest.fn().mockResolvedValue(asyncTaskIterator),
      };
      (redisService.getJobContext as jest.Mock).mockResolvedValue(fakeJobContext);

      const result = await service.fetchMigrationTask({ jobRunId: 'job-5' });
      expect(result.tasks).toEqual(fakeTasks);
    });

    it('should return an empty tasks array on error in fetchMigrationTask', async () => {
      (redisService.getJobContext as jest.Mock).mockRejectedValue(new Error('fetch migration error'));
      const result = await service.fetchMigrationTask({ jobRunId: 'job-5' });
      expect(result.tasks).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith('[job-5] Failed to fetch the task: Error: fetch migration error');
    });
  });

  describe('generateCOCReport', () => {
    it('should trigger generateCOCReport successfully', async () => {
      (getAccessToken as jest.Mock).mockResolvedValue('token123');
      mockedAxios.get.mockResolvedValue({});

      const result = await service.generateCOCReport('job-6');
      expect(result).toEqual({ message: 'Triggering generateCOCReport successful for job id: job-6' });
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'http://report-service/api/v1/report/job-run/coc-report/job-6',
        { headers: { Authorization: 'Bearer token123' } },
      );
      expect(logger.log).toHaveBeenCalledWith('[job-6] Triggering generateCOCReport successful');
    });

    it('should handle error when access token is not obtained in generateCOCReport', async () => {
      (getAccessToken as jest.Mock).mockResolvedValue(null);
      const result = await service.generateCOCReport('job-7');
      expect(result).toEqual({ message: 'Error while Triggering generateCOCReport for the job id : job-7' });
    });

    it('should handle axios.get error in generateCOCReport', async () => {
      (getAccessToken as jest.Mock).mockResolvedValue('token123');
      mockedAxios.get.mockRejectedValue(new Error('report error'));
      const result = await service.generateCOCReport('job-8');
      expect(result).toEqual({ message: 'Error while Triggering generateCOCReport for the job id : job-8' });
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to Trigger generateCOCReport'));
    });
  });

  describe('updateCutOverStatus', () => {
    it('should update cutover status successfully', async () => {
      (getAccessToken as jest.Mock).mockResolvedValue('token123');
      mockedAxios.put.mockResolvedValue({});

      const input = { jobRunId: 'job-9', status: 'COMPLETED' };
      const result = await service.updateCutOverStatus(input as any);
      expect(result).toEqual({ message: 'Job status updated for job id: job-9' });
      expect(mockedAxios.put).toHaveBeenCalledWith(
        'http://job-service/api/v1/job-run/cutover/job-9/COMPLETED',
        {},
        { headers: { Authorization: 'Bearer token123' } },
      );
      expect(logger.log).toHaveBeenCalledWith('[job-9] status updated to COMPLETED');
    });

    it('should return error when access token is not obtained in updateCutOverStatus', async () => {
      (getAccessToken as jest.Mock).mockResolvedValue(null);
      const input = { jobRunId: 'job-10', status: 'FAILED' };
      const result = await service.updateCutOverStatus(input as any);
      expect(result).toEqual({ message: 'Error while updating the status of the job id : job-10' });
    });

    it('should handle axios.put error in updateCutOverStatus', async () => {
      (getAccessToken as jest.Mock).mockResolvedValue('token123');
      mockedAxios.put.mockRejectedValue(new Error('put error'));
      const input = { jobRunId: 'job-11', status: 'FAILED' };
      const result = await service.updateCutOverStatus(input as any);
      expect(result).toEqual({ message: 'Error while updating the status of the job id : job-11' });
    });
  });
});
