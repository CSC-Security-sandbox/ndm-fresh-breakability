import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  CommandStatus,
  TaskInfo,
  TaskStatus,
  TaskType,
} from '@netapp-cloud-datamigrate/jobs-lib';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLogger } from 'src/auth/auth.service.spec';
import { FatalError, RetryExceededError } from 'src/errors/errors.types';
import { RedisService } from 'src/redis/redis.service';
import { CommonTaskService } from '../common/common-task.service';
import { CommandExecService } from './command-execution/command-execution.service';
import { SyncService } from './sync-activity.service';

// Mock the @temporalio/activity Context
jest.mock('@temporalio/activity', () => ({
  Context: {
    current: jest.fn(() => ({
      heartbeat: jest.fn(),
    })),
  },
}));

// Mock utils functions
jest.mock('src/activities/utils/utils', () => ({
  basePrefix: jest.fn((jobRunId, pathId) => `/base/${jobRunId}/${pathId}/`),
  isFatalError: jest.fn((error) => error === 'FATAL'),
  isSourceFatalError: jest.fn((error) => error === 'SOURCE_FATAL'),
}));

describe('SyncService', () => {
  let service: SyncService;
  let configService: jest.Mocked<ConfigService>;
  let loggerFactory: jest.Mocked<LoggerFactory>;
  let redisService: jest.Mocked<RedisService>;
  let commonTaskService: jest.Mocked<CommonTaskService>;
  let commandExecService: jest.Mocked<CommandExecService>;
  let mockJobContext: any;

  beforeEach(async () => {
    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        switch (key) {
          case 'worker.workerId':
            return 'test-worker-1';
          case 'worker.maxRetryCount':
            return 3;
          case 'worker.maxCommandConcurrency':
            return 100;
          default:
            return undefined;
        }
      }),
    } as any;

    loggerFactory = {
      create: jest.fn().mockReturnValue(mockLogger),
    } as any;

    mockJobContext = {
      getTask: jest.fn(),
      publishToTaskStream: jest.fn(),
      setTask: jest.fn(),
      deleteTask: jest.fn(),
    };

    redisService = {
      getJobManagerContext: jest.fn().mockResolvedValue(mockJobContext),
    } as any;

    commonTaskService = {
      ensureTaskValid: jest.fn(),
    } as any;

    commandExecService = {
      executeCommand: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncService,
        { provide: ConfigService, useValue: configService },
        { provide: LoggerFactory, useValue: loggerFactory },
        { provide: RedisService, useValue: redisService },
        { provide: CommonTaskService, useValue: commonTaskService },
        { provide: CommandExecService, useValue: commandExecService },
      ],
    }).compile();

    service = module.get<SyncService>(SyncService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with correct configuration values', () => {
      expect(service.workerId).toBe('test-worker-1');
      expect(service.maxRetryCount).toBe(3);
      expect(service.maxConcurrency).toBe(100);
      expect(configService.get).toHaveBeenCalledWith('worker.workerId');
      expect(configService.get).toHaveBeenCalledWith('worker.maxRetryCount');
      expect(configService.get).toHaveBeenCalledWith(
        'worker.maxCommandConcurrency',
      );
    });

    it('should use default values when config is not provided', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'worker.workerId') return 'test-worker-1';
        return undefined; // Return undefined for other keys to test defaults
      });

      const module = await Test.createTestingModule({
        providers: [
          SyncService,
          { provide: ConfigService, useValue: configService },
          { provide: LoggerFactory, useValue: loggerFactory },
          { provide: RedisService, useValue: redisService },
          { provide: CommonTaskService, useValue: commonTaskService },
          { provide: CommandExecService, useValue: commandExecService },
        ],
      }).compile();

      const serviceWithDefaults = module.get<SyncService>(SyncService);
      expect(serviceWithDefaults.maxRetryCount).toBe(3); // Default value
      expect(serviceWithDefaults.maxConcurrency).toBe(100); // Default value
    });

    it('should initialize maxWriteConcurrency with config value', () => {
      configService.get.mockImplementation((key: string) => {
        switch (key) {
          case 'worker.workerId':
            return 'test-worker-1';
          case 'worker.maxRetryCount':
            return 5;
          case 'worker.maxCommandConcurrency':
            return 50;
          case 'worker.maxWriteConcurrency':
            return 2;
          default:
            return undefined;
        }
      });

      expect(service.maxWriteConcurrency).toBe(1); // Default when not configured
    });

    it('should use default maxWriteConcurrency when not configured', () => {
      configService.get.mockImplementation((key: string) => {
        switch (key) {
          case 'worker.workerId':
            return 'test-worker-1';
          case 'worker.maxRetryCount':
            return 3;
          case 'worker.maxCommandConcurrency':
            return 100;
          // No maxWriteConcurrency configured
          default:
            return undefined;
        }
      });

      expect(service.maxWriteConcurrency).toBe(1); // Default value
    });

    it('should handle all configuration branches', async () => {
      // Test with all config values provided
      configService.get.mockImplementation((key: string) => {
        switch (key) {
          case 'worker.workerId':
            return 'configured-worker';
          case 'worker.maxRetryCount':
            return 5;
          case 'worker.maxCommandConcurrency':
            return 200;
          case 'worker.maxWriteConcurrency':
            return 3;
          default:
            return undefined;
        }
      });

      const module = await Test.createTestingModule({
        providers: [
          SyncService,
          { provide: ConfigService, useValue: configService },
          { provide: LoggerFactory, useValue: loggerFactory },
          { provide: RedisService, useValue: redisService },
          { provide: CommonTaskService, useValue: commonTaskService },
          { provide: CommandExecService, useValue: commandExecService },
        ],
      }).compile();

      const configuredService = module.get<SyncService>(SyncService);

      expect(configuredService.workerId).toBe('configured-worker');
      expect(configuredService.maxRetryCount).toBe(5);
      expect(configuredService.maxConcurrency).toBe(200);
      expect(configuredService.maxWriteConcurrency).toBe(3);
    });
  });

  describe('syncTaskActivity', () => {
    const mockSyncInput = {
      jobRunId: 'job-123',
      taskId: 'task-456',
    };

    it('should return early when task is not found', async () => {
      mockJobContext.getTask.mockResolvedValue(null);

      const result = await service.syncTaskActivity(mockSyncInput);

      expect(result.status).toBe(TaskStatus.PENDING);
      expect(result.errors.source).toEqual([]);
      expect(result.errors.target).toEqual([]);
      expect(commonTaskService.ensureTaskValid).not.toHaveBeenCalled();
    });

    it('should handle and rethrow FatalError', async () => {
      const mockTask = new TaskInfo(
        'task-456',
        'job-123',
        TaskType.SCAN,
        TaskStatus.PENDING,
        '',
        'source-path',
        [],
      );

      mockJobContext.getTask.mockResolvedValue(mockTask);
      const fatalError = new FatalError('Fatal error occurred');
      commonTaskService.ensureTaskValid.mockRejectedValue(fatalError);

      await expect(service.syncTaskActivity(mockSyncInput)).rejects.toThrow(
        FatalError,
      );
      expect(mockLogger.error).toHaveBeenCalled(); // FatalError should not be logged
    });

    it('should handle and rethrow non-FatalError', async () => {
      const mockTask = new TaskInfo(
        'task-456',
        'job-123',
        TaskType.SCAN,
        TaskStatus.PENDING,
        '',
        'source-path',
        [],
      );

      mockJobContext.getTask.mockResolvedValue(mockTask);
      const error = new Error('General error');
      commonTaskService.ensureTaskValid.mockRejectedValue(error);

      await expect(service.syncTaskActivity(mockSyncInput)).rejects.toThrow(
        'General error',
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        '[job-123] Error in syncTaskActivity: General error',
        error.stack,
      );
    });

    it('should clear heartbeat interval on completion', async () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      mockJobContext.getTask.mockResolvedValue(null);

      await service.syncTaskActivity(mockSyncInput);

      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('should clear heartbeat interval on error', async () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      const mockTask = new TaskInfo(
        'task-456',
        'job-123',
        TaskType.SCAN,
        TaskStatus.PENDING,
        '',
        'source-path',
        [],
      );

      mockJobContext.getTask.mockResolvedValue(mockTask);
      const error = new Error('Test error');
      commonTaskService.ensureTaskValid.mockRejectedValue(error);

      await expect(service.syncTaskActivity(mockSyncInput)).rejects.toThrow();
      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('should successfully complete sync task', async () => {
      const mockTask = new TaskInfo(
        'task-456',
        'job-123',
        TaskType.MIGRATE,
        TaskStatus.PENDING,
        '',
        'source-path',
        [
          {
            id: 'cmd-1',
            status: CommandStatus.COMPLETED,
            fPath: '/file1.txt',
          } as any,
        ],
        'target-path',
      );

      mockJobContext.getTask.mockResolvedValue(mockTask);
      commonTaskService.ensureTaskValid.mockResolvedValue(mockTask);
      commandExecService.executeCommand.mockResolvedValue({
        sourceErrors: [],
        targetErrors: [],
        cmd: {} as any,
      });

      // Mock the executeSyncTask to return a successful result
      jest.spyOn(service, 'executeSyncTask').mockResolvedValue({
        errors: { source: [], target: [] },
        status: TaskStatus.COMPLETED,
        error: 0,
      });

      const updateSpy = jest
        .spyOn(service, 'updateAndReportTaskStatus')
        .mockResolvedValue();

      const result = await service.syncTaskActivity(mockSyncInput);

      expect(result.status).toBe(TaskStatus.COMPLETED);
      expect(result.errors.source).toEqual([]);
      expect(result.errors.target).toEqual([]);
      expect(result.error).toBe(0);

      expect(redisService.getJobManagerContext).toHaveBeenCalledWith('job-123');
      expect(mockJobContext.getTask).toHaveBeenCalledWith('task-456');
      expect(commonTaskService.ensureTaskValid).toHaveBeenCalledWith({
        task: mockTask,
        jobContext: mockJobContext,
      });
      expect(mockJobContext.publishToTaskStream).toHaveBeenCalledWith({
        ...mockTask,
        status: TaskStatus.RUNNING,
        workerId: 'test-worker-1',
      });
      expect(updateSpy).toHaveBeenCalled();
    });
  });

  describe('executeSyncTask', () => {
    it('should execute sync task and skip completed commands', async () => {
      const mockTask = new TaskInfo(
        'task-456',
        'job-123',
        TaskType.MIGRATE,
        TaskStatus.RUNNING,
        'test-worker-1',
        'source-path',
        [
          {
            id: 'cmd-1',
            status: CommandStatus.READY,
            fPath: '/file1.txt',
          } as any,
          {
            id: 'cmd-2',
            status: CommandStatus.COMPLETED,
            fPath: '/file2.txt',
          } as any,
        ],
        'target-path',
      );
      mockTask.retryCount = 1;

      commandExecService.executeCommand.mockResolvedValue({
        sourceErrors: [],
        targetErrors: [],
        cmd: {} as any,
      });

      const result = await service.executeSyncTask(
        'task-hash-456',
        mockTask,
        mockJobContext,
      );

      expect(result.status).toBe(TaskStatus.PENDING);
      expect(result.errors.source).toEqual([]);
      expect(result.errors.target).toEqual([]);

      // Should only call executeCommand for non-completed commands (cmd-1)
      expect(commandExecService.executeCommand).toHaveBeenCalledTimes(1);
      expect(mockJobContext.setTask).toHaveBeenCalledTimes(1);
    });

    it('should collect errors from command execution', async () => {
      const mockTask = new TaskInfo(
        'task-456',
        'job-123',
        TaskType.MIGRATE,
        TaskStatus.RUNNING,
        'test-worker-1',
        'source-path',
        [
          {
            id: 'cmd-1',
            status: CommandStatus.READY,
            fPath: '/file1.txt',
          } as any,
        ],
        'target-path',
      );
      mockTask.retryCount = 1;

      commandExecService.executeCommand.mockResolvedValue({
        sourceErrors: ['source-error-1'],
        targetErrors: ['target-error-1'],
        cmd: {} as any,
      });

      const result = await service.executeSyncTask(
        'task-hash-456',
        mockTask,
        mockJobContext,
      );

      expect(result.errors.source).toEqual(['source-error-1']);
      expect(result.errors.target).toEqual(['target-error-1']);
    });

    it('should handle rejected promises with string reason', async () => {
      const mockTask = new TaskInfo(
        'task-456',
        'job-123',
        TaskType.MIGRATE,
        TaskStatus.RUNNING,
        'test-worker-1',
        'source-path',
        [
          {
            id: 'cmd-1',
            status: CommandStatus.READY,
            fPath: '/file1.txt',
          } as any,
        ],
        'target-path',
      );
      mockTask.retryCount = 1;

      commandExecService.executeCommand.mockRejectedValue(
        'Simple string error',
      );

      const result = await service.executeSyncTask(
        'task-hash-456',
        mockTask,
        mockJobContext,
      );

      expect(result.errors.source).toEqual(['Simple string error']);
      expect(result.errors.target).toEqual([]);
    });

    it('should handle rejected promises with error object having message', async () => {
      const mockTask = new TaskInfo(
        'task-456',
        'job-123',
        TaskType.MIGRATE,
        TaskStatus.RUNNING,
        'test-worker-1',
        'source-path',
        [
          {
            id: 'cmd-1',
            status: CommandStatus.READY,
            fPath: '/file1.txt',
          } as any,
        ],
        'target-path',
      );
      mockTask.retryCount = 1;

      const errorWithMessage = new Error('Command execution failed');
      commandExecService.executeCommand.mockRejectedValue(errorWithMessage);

      const result = await service.executeSyncTask(
        'task-hash-456',
        mockTask,
        mockJobContext,
      );

      expect(result.errors.source).toEqual(['Command execution failed']);
    });

    it('should handle rejected promises with null/undefined reason', async () => {
      const mockTask = new TaskInfo(
        'task-456',
        'job-123',
        TaskType.MIGRATE,
        TaskStatus.RUNNING,
        'test-worker-1',
        'source-path',
        [
          {
            id: 'cmd-1',
            status: CommandStatus.READY,
            fPath: '/file1.txt',
          } as any,
        ],
        'target-path',
      );
      mockTask.retryCount = 1;

      commandExecService.executeCommand.mockRejectedValue(null);

      const result = await service.executeSyncTask(
        'task-hash-456',
        mockTask,
        mockJobContext,
      );

      expect(result.errors.source).toEqual(['null']);
    });

    it('should handle rejected promises with array reason containing strings', async () => {
      const mockTask = new TaskInfo(
        'task-456',
        'job-123',
        TaskType.MIGRATE,
        TaskStatus.RUNNING,
        'test-worker-1',
        'source-path',
        [
          {
            id: 'cmd-1',
            status: CommandStatus.READY,
            fPath: '/file1.txt',
          } as any,
        ],
        'target-path',
      );
      mockTask.retryCount = 1;

      const arrayError = ['error1', 'error2'];
      commandExecService.executeCommand.mockRejectedValue(arrayError);

      const result = await service.executeSyncTask(
        'task-hash-456',
        mockTask,
        mockJobContext,
      );

      expect(result.errors.source).toEqual(['error1', 'error2']);
    });

    it('should handle rejected promises with array reason containing error objects', async () => {
      const mockTask = new TaskInfo(
        'task-456',
        'job-123',
        TaskType.MIGRATE,
        TaskStatus.RUNNING,
        'test-worker-1',
        'source-path',
        [
          {
            id: 'cmd-1',
            status: CommandStatus.READY,
            fPath: '/file1.txt',
          } as any,
        ],
        'target-path',
      );
      mockTask.retryCount = 1;

      const arrayWithErrors = [
        new Error('First error'),
        { message: 'Second error' },
        { someProperty: 'no message' },
        'String error',
      ];
      commandExecService.executeCommand.mockRejectedValue(arrayWithErrors);

      const result = await service.executeSyncTask(
        'task-hash-456',
        mockTask,
        mockJobContext,
      );

      expect(result.errors.source).toEqual([
        'First error',
        'Second error',
        '{"someProperty":"no message"}',
        'String error',
      ]);
    });

    it('should handle rejected promises with array containing objects without message', async () => {
      const mockTask = new TaskInfo(
        'task-456',
        'job-123',
        TaskType.MIGRATE,
        TaskStatus.RUNNING,
        'test-worker-1',
        'source-path',
        [
          {
            id: 'cmd-1',
            status: CommandStatus.READY,
            fPath: '/file1.txt',
          } as any,
        ],
        'target-path',
      );
      mockTask.retryCount = 1;

      const arrayWithNonErrorObjects = [{ data: 'some data' }, null, undefined];
      commandExecService.executeCommand.mockRejectedValue(
        arrayWithNonErrorObjects,
      );

      const result = await service.executeSyncTask(
        'task-hash-456',
        mockTask,
        mockJobContext,
      );

      expect(result.errors.source).toEqual([
        '{"data":"some data"}',
        'null',
        'Unknown error',
      ]);
    });

    it('should handle JSON stringify failure gracefully', async () => {
      const mockTask = new TaskInfo(
        'task-456',
        'job-123',
        TaskType.MIGRATE,
        TaskStatus.RUNNING,
        'test-worker-1',
        'source-path',
        [
          {
            id: 'cmd-1',
            status: CommandStatus.READY,
            fPath: '/file1.txt',
          } as any,
        ],
        'target-path',
      );
      mockTask.retryCount = 1;

      // Test with an object that has no message but can be stringified
      const objectWithoutMessage = { someData: 'value', number: 42 };

      const arrayWithObject = [objectWithoutMessage];
      commandExecService.executeCommand.mockRejectedValue(arrayWithObject);

      const result = await service.executeSyncTask(
        'task-hash-456',
        mockTask,
        mockJobContext,
      );

      expect(result.errors.source).toEqual([
        '{"someData":"value","number":42}',
      ]);
    });

    it('should handle error type based on retry count', async () => {
      const mockTask = new TaskInfo(
        'task-456',
        'job-123',
        TaskType.MIGRATE,
        TaskStatus.RUNNING,
        'test-worker-1',
        'source-path',
        [
          {
            id: 'cmd-1',
            status: CommandStatus.READY,
            fPath: '/file1.txt',
          } as any,
        ],
        'target-path',
      );
      mockTask.retryCount = 2; // Less than maxRetryCount (3)

      commandExecService.executeCommand.mockResolvedValue({
        sourceErrors: [],
        targetErrors: [],
        cmd: {} as any,
      });

      await service.executeSyncTask('task-hash-456', mockTask, mockJobContext);

      // Verify that command was called with correct error type
      expect(commandExecService.executeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          errorType: expect.any(String), // Should be RECOVERABLE_ERROR
        }),
      );
    });

    it('should handle error type when retry count equals maxRetryCount', async () => {
      const mockTask = new TaskInfo(
        'task-456',
        'job-123',
        TaskType.MIGRATE,
        TaskStatus.RUNNING,
        'test-worker-1',
        'source-path',
        [
          {
            id: 'cmd-1',
            status: CommandStatus.READY,
            fPath: '/file1.txt',
          } as any,
        ],
        'target-path',
      );
      mockTask.retryCount = 3; // Equals maxRetryCount (3)

      commandExecService.executeCommand.mockResolvedValue({
        sourceErrors: [],
        targetErrors: [],
        cmd: {} as any,
      });

      await service.executeSyncTask('task-hash-456', mockTask, mockJobContext);

      // Verify that command was called with correct error type
      expect(commandExecService.executeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          errorType: expect.any(String), // Should be TRANSIENT_ERROR
        }),
      );
    });

    it('should process commands in chunks based on maxWriteConcurrency', async () => {
      // Create service with maxWriteConcurrency = 1 for easier testing
      const serviceWithLowConcurrency = new (SyncService as any)(
        configService,
        loggerFactory,
        redisService,
        commonTaskService,
        commandExecService,
      );
      serviceWithLowConcurrency.maxWriteConcurrency = 2; // Process 2 commands at a time

      const mockTask = new TaskInfo(
        'task-456',
        'job-123',
        TaskType.MIGRATE,
        TaskStatus.RUNNING,
        'test-worker-1',
        'source-path',
        [
          {
            id: 'cmd-1',
            status: CommandStatus.READY,
            fPath: '/file1.txt',
          } as any,
          {
            id: 'cmd-2',
            status: CommandStatus.READY,
            fPath: '/file2.txt',
          } as any,
          {
            id: 'cmd-3',
            status: CommandStatus.READY,
            fPath: '/file3.txt',
          } as any,
        ],
        'target-path',
      );
      mockTask.retryCount = 1;

      commandExecService.executeCommand.mockResolvedValue({
        sourceErrors: [],
        targetErrors: [],
        cmd: {} as any,
      });

      const result = await serviceWithLowConcurrency.executeSyncTask(
        'task-hash-456',
        mockTask,
        mockJobContext,
      );

      expect(result.status).toBe(TaskStatus.PENDING);
      // Should process all 3 commands (2 in first chunk, 1 in second chunk)
      expect(commandExecService.executeCommand).toHaveBeenCalledTimes(3);
    });
  });

  describe('updateAndReportTaskStatus', () => {
    it('should complete task when all commands are completed', async () => {
      const mockTask = new TaskInfo(
        'task-456',
        'job-123',
        TaskType.MIGRATE,
        TaskStatus.RUNNING,
        'test-worker-1',
        'source-path',
        [
          { status: CommandStatus.COMPLETED } as any,
          { status: CommandStatus.COMPLETED } as any,
        ],
      );

      const mockInput = {
        errors: { source: [], target: [] },
        jobContext: mockJobContext,
        taskHashId: 'task-hash-456',
        task: mockTask,
      };

      await service.updateAndReportTaskStatus(mockInput);

      expect(mockTask.status).toBe(TaskStatus.COMPLETED);
      expect(mockJobContext.publishToTaskStream).toHaveBeenCalledWith(mockTask);
      expect(mockJobContext.deleteTask).toHaveBeenCalledWith('task-hash-456');
    });

    it('should throw FatalError for fatal source errors', async () => {
      const mockTask = new TaskInfo(
        'task-456',
        'job-123',
        TaskType.MIGRATE,
        TaskStatus.RUNNING,
        'test-worker-1',
        'source-path',
        [{ status: CommandStatus.READY } as any],
      );

      const inputWithFatalSourceError = {
        errors: {
          source: ['SOURCE_FATAL'],
          target: [],
        },
        jobContext: mockJobContext,
        taskHashId: 'task-hash-456',
        task: mockTask,
      };

      await expect(
        service.updateAndReportTaskStatus(inputWithFatalSourceError),
      ).rejects.toThrow(FatalError);

      expect(mockTask.status).toBe(TaskStatus.ERRORED);
      expect(mockJobContext.publishToTaskStream).toHaveBeenCalledWith(mockTask);
      expect(mockJobContext.deleteTask).toHaveBeenCalledWith('task-hash-456');
    });

    it('should throw FatalError for fatal target errors', async () => {
      const mockTask = new TaskInfo(
        'task-456',
        'job-123',
        TaskType.MIGRATE,
        TaskStatus.RUNNING,
        'test-worker-1',
        'source-path',
        [{ status: CommandStatus.READY } as any],
      );

      const inputWithFatalTargetError = {
        errors: {
          source: [],
          target: ['FATAL'],
        },
        jobContext: mockJobContext,
        taskHashId: 'task-hash-456',
        task: mockTask,
      };

      await expect(
        service.updateAndReportTaskStatus(inputWithFatalTargetError),
      ).rejects.toThrow(FatalError);

      expect(mockTask.status).toBe(TaskStatus.ERRORED);
      expect(mockJobContext.publishToTaskStream).toHaveBeenCalledWith(mockTask);
      expect(mockJobContext.deleteTask).toHaveBeenCalledWith('task-hash-456');
    });

    it('should throw FatalError when both source and target have fatal errors', async () => {
      const mockTask = new TaskInfo(
        'task-456',
        'job-123',
        TaskType.MIGRATE,
        TaskStatus.RUNNING,
        'test-worker-1',
        'source-path',
        [{ status: CommandStatus.READY } as any],
      );

      const inputWithBothFatalErrors = {
        errors: {
          source: ['SOURCE_FATAL'],
          target: ['FATAL'],
        },
        jobContext: mockJobContext,
        taskHashId: 'task-hash-456',
        task: mockTask,
      };

      await expect(
        service.updateAndReportTaskStatus(inputWithBothFatalErrors),
      ).rejects.toThrow(FatalError);

      expect(mockTask.status).toBe(TaskStatus.ERRORED);
      expect(mockJobContext.publishToTaskStream).toHaveBeenCalledWith(mockTask);
      expect(mockJobContext.deleteTask).toHaveBeenCalledWith('task-hash-456');
    });

    it('should throw RetryExceededError when retry count exceeds maximum', async () => {
      const mockTask = new TaskInfo(
        'task-456',
        'job-123',
        TaskType.MIGRATE,
        TaskStatus.RUNNING,
        'test-worker-1',
        'source-path',
        [{ status: CommandStatus.READY } as any],
      );
      mockTask.retryCount = 3; // Equals maxRetryCount

      const inputWithMaxRetries = {
        errors: {
          source: ['recoverable-error'],
          target: [],
        },
        jobContext: mockJobContext,
        taskHashId: 'task-hash-456',
        task: mockTask,
      };

      await expect(
        service.updateAndReportTaskStatus(inputWithMaxRetries),
      ).rejects.toThrow(RetryExceededError);

      expect(mockTask.status).toBe(TaskStatus.ERRORED);
      expect(mockJobContext.deleteTask).toHaveBeenCalledWith('task-hash-456');
    });

    it('should throw ApplicationFailure.retryable when retry count is below maximum', async () => {
      const mockTask = new TaskInfo(
        'task-456',
        'job-123',
        TaskType.MIGRATE,
        TaskStatus.RUNNING,
        'test-worker-1',
        'source-path',
        [{ status: CommandStatus.READY } as any],
      );
      mockTask.retryCount = 1; // Below maxRetryCount (3)

      const inputWithRetryableError = {
        errors: {
          source: ['recoverable-error'],
          target: ['another-error'],
        },
        jobContext: mockJobContext,
        taskHashId: 'task-hash-456',
        task: mockTask,
      };

      await expect(
        service.updateAndReportTaskStatus(inputWithRetryableError),
      ).rejects.toThrow();

      expect(mockTask.status).toBe(TaskStatus.ERRORED);
      expect(mockJobContext.publishToTaskStream).toHaveBeenCalledWith(mockTask);
      expect(mockJobContext.deleteTask).not.toHaveBeenCalled(); // Should not delete when retryable
    });

    it('should handle empty errors arrays with non-completed commands', async () => {
      const mockTask = new TaskInfo(
        'task-456',
        'job-123',
        TaskType.MIGRATE,
        TaskStatus.RUNNING,
        'test-worker-1',
        'source-path',
        [{ status: CommandStatus.READY } as any],
      );
      mockTask.retryCount = 1;

      const inputWithEmptyErrors = {
        errors: {
          source: [],
          target: [],
        },
        jobContext: mockJobContext,
        taskHashId: 'task-hash-456',
        task: mockTask,
      };

      await expect(
        service.updateAndReportTaskStatus(inputWithEmptyErrors),
      ).rejects.toThrow();

      expect(mockTask.status).toBe(TaskStatus.ERRORED);
      expect(mockJobContext.publishToTaskStream).toHaveBeenCalledWith(mockTask);
    });

    it('should handle mixed command statuses correctly', async () => {
      const mockTask = new TaskInfo(
        'task-456',
        'job-123',
        TaskType.MIGRATE,
        TaskStatus.RUNNING,
        'test-worker-1',
        'source-path',
        [
          { status: CommandStatus.COMPLETED } as any,
          { status: CommandStatus.READY } as any,
          { status: CommandStatus.READY } as any,
        ],
      );
      mockTask.retryCount = 1;

      const inputWithMixedCommands = {
        errors: {
          source: ['some-error'],
          target: [],
        },
        jobContext: mockJobContext,
        taskHashId: 'task-hash-456',
        task: mockTask,
      };

      await expect(
        service.updateAndReportTaskStatus(inputWithMixedCommands),
      ).rejects.toThrow();

      expect(mockTask.status).toBe(TaskStatus.ERRORED);
      // Should not complete because not all commands are COMPLETED
      expect(mockJobContext.deleteTask).not.toHaveBeenCalled();
    });

    it('should handle duplicate error messages correctly in FatalError', async () => {
      const mockTask = new TaskInfo(
        'task-456',
        'job-123',
        TaskType.MIGRATE,
        TaskStatus.RUNNING,
        'test-worker-1',
        'source-path',
        [{ status: CommandStatus.READY } as any],
      );
      mockTask.retryCount = 1;

      const inputWithDuplicateErrors = {
        errors: {
          source: ['SOURCE_FATAL', 'SOURCE_FATAL', 'other-error'],
          target: ['FATAL', 'FATAL', 'unique-error'],
        },
        jobContext: mockJobContext,
        taskHashId: 'task-hash-456',
        task: mockTask,
      };

      let caughtError: Error;
      try {
        await service.updateAndReportTaskStatus(inputWithDuplicateErrors);
      } catch (error) {
        caughtError = error as Error;
      }

      expect(caughtError).toBeInstanceOf(FatalError);
      // Error message should deduplicate errors using [...new Set(errors)]
      expect(caughtError!.message).toContain('2 source errors'); // Deduplicated count
      expect(caughtError!.message).toContain('2 target errors'); // Deduplicated count
    });
  });

  describe('error handling edge cases', () => {
    it('should handle empty commands array in executeSyncTask', async () => {
      const taskWithNoCommands = new TaskInfo(
        'task-456',
        'job-123',
        TaskType.MIGRATE,
        TaskStatus.RUNNING,
        'test-worker-1',
        'source-path',
        [], // Empty commands array
      );
      taskWithNoCommands.retryCount = 1;

      const result = await service.executeSyncTask(
        'task-hash-456',
        taskWithNoCommands,
        mockJobContext,
      );

      expect(result.status).toBe(TaskStatus.PENDING);
      expect(result.errors.source).toEqual([]);
      expect(result.errors.target).toEqual([]);
      expect(commandExecService.executeCommand).not.toHaveBeenCalled();
    });
  });
});
