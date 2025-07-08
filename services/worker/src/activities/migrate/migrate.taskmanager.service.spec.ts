import { HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import { AuthService } from 'src/auth/auth.service';
import { RedisService } from 'src/redis/redis.service';
import { MigrationTaskService } from './migrate.taskmanager.service';
import { CutOverStatus } from './migrate.type';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('MigrationTaskService', () => {
  let service: MigrationTaskService;
  let redisService: any;
  let authService: any;
  let configService: any;

  const mockJobContext = {
    groupReadDirs: jest.fn(),
    appendToTaskList: jest.fn(),
    tasksInfo: { lastId: null },
    groupReadTasks: jest.fn(),
    groupReadMigrationTask: jest.fn(),
  };

  beforeEach(async () => {
    redisService = { getJobContext: jest.fn() };
    authService = { getAccessToken: jest.fn() };
    configService = {
      get: jest.fn((key) => {
        const map = {
          'worker.workerId': 'worker-123',
          'worker.connection.workerJobServiceUrl': 'http://job-service',
          'worker.connection.workerReportServiceUrl': 'http://report-service',
          'worker.fetchTaskBatchMigration': 1,
          'worker.maxScanCommand': 2,
        };
        return map[key];
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MigrationTaskService,
        Logger,
        { provide: ConfigService, useValue: configService },
        { provide: RedisService, useValue: redisService },
        { provide: AuthService, useValue: authService },
        { provide: HttpService, useValue: {} },
      ],
    }).compile();

    service = module.get<MigrationTaskService>(MigrationTaskService);
  });

  describe('publishScanTask', () => {
    it('should publish scan task successfully', async () => {
      redisService.getJobContext.mockResolvedValue(mockJobContext);

      mockJobContext.groupReadDirs.mockImplementation(async function* () {
        yield { path: '/dir1' };
        yield { path: '/dir2' };
      });

      mockJobContext.appendToTaskList.mockResolvedValue('task-1');

      const result = await service.publishScanTask({ jobRunId: 'job-123' });
      expect(result.status).toBeDefined();
    });

    it('should handle error during publish scan task', async () => {
      redisService.getJobContext.mockRejectedValue(new Error('Redis error'));
      const result = await service.publishScanTask({ jobRunId: 'job-123' });
      expect(result.status).toBe('error');
    });
  });

  describe('generateCOCReport', () => {
    it('should generate COC report successfully', async () => {
      authService.getAccessToken.mockResolvedValue('token-123');
      mockedAxios.get.mockResolvedValue({});

      const result = await service.generateCOCReport('job-123');
      expect(result.message).toContain('successful');
      expect(mockedAxios.get).toHaveBeenCalled();
    });

    it('should handle missing access token', async () => {
      authService.getAccessToken.mockResolvedValue(null);
      const result = await service.generateCOCReport('job-123');
      expect(result.message).toContain('Error');
    });

    it('should handle error while generating COC report', async () => {
      authService.getAccessToken.mockResolvedValue('token-123');
      mockedAxios.get.mockRejectedValue(new Error('Network error'));
      const result = await service.generateCOCReport('job-123');
      expect(result.message).toContain('Error');
    });
  });

  describe('updateCutOverStatus', () => {
    it('should update cutover status successfully', async () => {
      authService.getAccessToken.mockResolvedValue('token-123');
      mockedAxios.put.mockResolvedValue({});

      const result = await service.updateCutOverStatus({ jobRunId: 'job-123', status: CutOverStatus.APPROVED });
      expect(result.message).toContain('updated');
    });

    it('should handle access token fetch failure', async () => {
      authService.getAccessToken.mockResolvedValue(null);
      const result = await service.updateCutOverStatus({ jobRunId: 'job-123', status: CutOverStatus.APPROVED });
      expect(result.message).toContain('Error');
    });

    it('should handle error while updating status', async () => {
      authService.getAccessToken.mockResolvedValue('token-123');
      mockedAxios.put.mockRejectedValue(new Error('Request failed'));
      const result = await service.updateCutOverStatus({ jobRunId: 'job-123', status:  CutOverStatus.REJECTED });
      expect(result.message).toContain('Error');
    });


    it('should handle error thrown inside groupReadWithoutAckDirs', async () => {
      const mockJobContextWithError = {
      groupReadWithoutAckDirs: jest.fn(() => {
        throw new Error('Iterator error');
      }),
      ackDirAndCreateTask: jest.fn(),
      };
      redisService.getJobContext.mockResolvedValue(mockJobContextWithError);

      const result = await service.publishScanTask({ jobRunId: 'job-789' });
      expect(result.status).toBe('error');
      expect(result.message).toContain('Failed to publish task');
    });

    it('should publish scan task and call ackDirAndCreateTask when tasks are created', async () => {
      const mockAckDirAndCreateTask = jest.fn();
      const mockJobContextWithIterator = {
      groupReadWithoutAckDirs: jest.fn(async function* () {
        yield { data: { path: '/dir1' }, id: 'id1' };
        yield { data: { path: '/dir2' }, id: 'id2' };
      }),
      ackDirAndCreateTask: mockAckDirAndCreateTask,
      };
      redisService.getJobContext.mockResolvedValue(mockJobContextWithIterator);

      jest.mock('../utils/utils', () => ({
      buildTask: jest.fn(() => ({ dummy: 'task' })),
      }));

      await service.publishScanTask({ jobRunId: 'job-456' });
    });

    it('should not call ackDirAndCreateTask if no tasks are created', async () => {
      const mockAckDirAndCreateTask = jest.fn();
      const mockJobContextWithEmptyIterator = {
      groupReadWithoutAckDirs: jest.fn(async function* () {
      }),
      ackDirAndCreateTask: mockAckDirAndCreateTask,
      };
      redisService.getJobContext.mockResolvedValue(mockJobContextWithEmptyIterator);

      const result = await service.publishScanTask({ jobRunId: 'job-999' });
      expect(mockAckDirAndCreateTask).not.toHaveBeenCalled();
    });
  });
});
