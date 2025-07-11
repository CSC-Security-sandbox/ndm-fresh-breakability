import { Test, TestingModule } from '@nestjs/testing';
import { MigrationScanService } from './migrate.scan.service';
import { ConfigService } from '@nestjs/config';
import { RedisService } from 'src/redis/redis.service';
import { CommonActivityService } from '../common/common.service';
import { Logger } from "@nestjs/common";
import { JobContext, JobConfig, Command, CommandStatus, Task, TaskType, TaskStatus, FileServerDetails, NFS, OPS_CMD, ErrorType } from "@netapp-cloud-datamigrate/jobs-lib"
import * as fs from 'fs';
import { ScanContentInput } from './migrate.type';
import { RedisClientType } from 'redis';
import * as utils from '../utils/utils';
import { Origin } from '../utils/utils.types';

jest.mock('@temporalio/activity', () => ({
  Context: {
    current: jest.fn().mockResolvedValue(() => ({
      heartbeat: jest.fn(),
    }))
  },
}))

jest.mock('winston-daily-rotate-file', () => {
  const DailyRotateFile = jest.fn();
  return { default: DailyRotateFile };
});

jest.mock('@temporalio/activity', () => ({
  Context: {
    current: jest.fn(),
  },
}));

jest.mock('winston', () => {
  const actualWinston = jest.requireActual('winston');
  return {
    ...actualWinston,
    createLogger: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
    transports: {
      ...actualWinston.transports,
      DailyRotateFile: jest.fn(),
    },
  };
});

jest.mock('src/redis/redis.service');
jest.mock('../common/common.service');

const stream = {
  jobRunId: 'job1',
  streamKey: 'stream1',
  numMessages: 0,
  lastId: '0-0',
  init: jest.fn(),
  cleanup: jest.fn(),
  close: jest.fn(),
  append: jest.fn(),
  read: jest.fn(),
  groupRead: jest.fn(),
  consumerGroupCount: 2,
  readAndPurge: jest.fn(),
  getLength: jest.fn(),
  groupReadWithoutAck: jest.fn(),
  groupReadWithoutAckDirs: jest.fn(),
  ackAndCreateTask: jest.fn(),
}

describe('MigrationScanService', () => {
  let redisClient: RedisClientType;

  beforeEach(() => {
    redisClient = {
      exists: jest.fn(),
      del: jest.fn(),
      set: jest.fn(),
      stats: jest.fn(),
      hIncrBy: jest.fn(),
      disconnect: jest.fn(),
    } as unknown as RedisClientType;

  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  let service: MigrationScanService;
  let mockConfigService: Partial<ConfigService>;
  let mockRedisService: Partial<RedisService>;
  let mockCommonService: Partial<CommonActivityService>;
  let mockLogger: Partial<Logger>;

  class TestJobContext extends JobContext {
    constructor(jobRunId: string, jobConfig?: JobConfig, jobRunStatus?: string) {
      super(jobRunId, jobConfig, jobRunStatus);
      this.filesInfo = stream;
      this.dirsInfo = stream;
      this.errorsInfo = stream;
      this.tasksInfo = stream;
      this.migrateTask = stream;
      this.updatedTaskInfo = stream;
      this.taskStats = stream;
      this.setScanTask = jest.fn();
      this.getScanTask = jest.fn();
      this.deleteAllScanTasks = jest.fn();
      this.appendToErrorList = jest.fn();
      this.runningScanTask = {
        deleteValue: jest.fn()
      }
    }
    async init() { }
    async close() { }
    async cleanup() { }
  }

  beforeEach(async () => {
    mockLogger = { debug: jest.fn(), log: jest.fn(), error: jest.fn() };

    mockConfigService = {
      get: jest.fn((key) => {
        switch (key) {
          case 'worker.workerId':
            return 'test-worker-id';
          case 'worker.maxRetryCount':
            return 3;
          case 'worker.maxMigrationCommand':
            return 1000;
          default:
            return null;
        }
      }),
    };

    mockRedisService = {
      getJobContext: jest.fn().mockResolvedValue({} as JobContext),
      setJobContext: jest.fn(),
    };

    mockCommonService = {
      fetchOneTask: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MigrationScanService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: Logger, useValue: mockLogger }, // Ensure Logger is provided
        { provide: RedisService, useValue: mockRedisService },
        { provide: CommonActivityService, useValue: mockCommonService },
      ],
    }).compile();

    service = module.get<MigrationScanService>(MigrationScanService);
  });

  describe('getDirectoryContents', () => {
    let mockJobContext: Partial<JobContext>;

    beforeEach(() => {
      mockJobContext = {
        jobRunId: 'test-job-run-id'
      };

      // Mock the external functions
      jest.spyOn(require('../utils/utils'), 'getServerInfoFromPath').mockReturnValue({
        serverName: 'test-server',
        serverUrl: 'test-url'
      });

      jest.spyOn(require('../utils/utils'), 'createServerDownErrorMessage').mockReturnValue(
        'Server test-server is down or unreachable'
      );
    });

    afterEach(() => {
      jest.clearAllMocks();
      jest.clearAllTimers();
    });

    it('should return directory contents when directory is accessible', async () => {
      const directoryPath = '/test/directory';
      const expectedContents = ['file1.txt', 'file2.txt', 'folder1'];

      jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
      jest.spyOn(fs.promises, 'readdir').mockResolvedValue(expectedContents as any);

      const result = await service.getDirectoryContents(directoryPath, mockJobContext as JobContext,  Origin.SOURCE);

      expect(fs.promises.access).toHaveBeenCalledWith(directoryPath, fs.constants.R_OK);
      expect(fs.promises.readdir).toHaveBeenCalledWith(directoryPath);
      expect(result).toEqual(expectedContents);
    });

    it('should throw an error when directory is not accessible', async () => {
      const directoryPath = '/inaccessible/directory';
      const accessError = new Error('Permission denied');
      (accessError as any).code = 'EACCES';

      jest.spyOn(fs.promises, 'access').mockRejectedValue(accessError);

      await expect(service.getDirectoryContents(directoryPath, mockJobContext as JobContext,  Origin.SOURCE))
        .rejects.toThrow('Permission denied');

      expect(fs.promises.access).toHaveBeenCalledWith(directoryPath, fs.constants.R_OK);
      expect(fs.promises.readdir).not.toHaveBeenCalled();
    });

    it('should throw timeout error when readdir operation takes too long - alternative', async () => {
      // Test with a very short timeout instead of using fake timers
      const originalTimeout = service.operationTimeout;
      (service as any).operationTimeout = 100; // 100ms timeout

      const directoryPath = '/slow/directory';

      jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
      jest.spyOn(fs.promises, 'readdir').mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve(['file.txt'] as any), 200)) // Takes 200ms
      );

      await expect(service.getDirectoryContents(directoryPath, mockJobContext as JobContext,  Origin.SOURCE))
        .rejects.toThrow('Server test-server is down or unreachable');

      // Restore original timeout
      (service as any).operationTimeout = originalTimeout;
    }, 1000);

    it('should handle readdir errors properly', async () => {
      const directoryPath = '/error/directory';
      const readdirError = new Error('Read error');
      (readdirError as any).code = 'EIO';

      jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
      jest.spyOn(fs.promises, 'readdir').mockRejectedValue(readdirError);

      await expect(service.getDirectoryContents(directoryPath, mockJobContext as JobContext,  Origin.SOURCE))
        .rejects.toThrow('Read error');

      expect(fs.promises.access).toHaveBeenCalledWith(directoryPath, fs.constants.R_OK);
      expect(fs.promises.readdir).toHaveBeenCalledWith(directoryPath);
    });

    it('should return empty array for empty directory', async () => {
      const directoryPath = '/empty/directory';
      const expectedContents: string[] = [];

      jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
      jest.spyOn(fs.promises, 'readdir').mockResolvedValue(expectedContents as any);

      const result = await service.getDirectoryContents(directoryPath, mockJobContext as JobContext,  Origin.SOURCE);

      expect(result).toEqual([]);
    });

    it('should complete successfully when readdir resolves before timeout', async () => {
      jest.useFakeTimers();

      const directoryPath = '/fast/directory';
      const expectedContents = ['quick-file.txt'];

      jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
      jest.spyOn(fs.promises, 'readdir').mockResolvedValue(expectedContents as any);

      const promise = service.getDirectoryContents(directoryPath, mockJobContext as JobContext,  Origin.SOURCE);

      // Since readdir resolves immediately, we don't need to advance timers
      const result = await promise;

      expect(result).toEqual(expectedContents);

      jest.useRealTimers();
    });

    it('should use correct server info for timeout error message', async () => {
      const directoryPath = '/timeout/directory';
      const mockServerInfo = { serverName: 'custom-server', serverUrl: 'custom-url' };

      // Set a very short timeout for this test
      const originalTimeout = service.operationTimeout;
      (service as any).operationTimeout = 50; // 50ms timeout

      jest.spyOn(require('../utils/utils'), 'getServerInfoFromPath')
        .mockReturnValue(mockServerInfo);

      jest.spyOn(require('../utils/utils'), 'createServerDownErrorMessage')
        .mockReturnValue('Custom server error message');

      jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
      jest.spyOn(fs.promises, 'readdir').mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve(['file.txt'] as any), 100)) // Takes 100ms, longer than timeout
      );

      await expect(service.getDirectoryContents(directoryPath, mockJobContext as JobContext, Origin.SOURCE))
        .rejects.toThrow('Custom server error message');

      expect(require('../utils/utils').getServerInfoFromPath)
        .toHaveBeenCalledWith(directoryPath, mockJobContext);
      expect(require('../utils/utils').createServerDownErrorMessage)
        .toHaveBeenCalledWith('ETIMEDOUT', mockServerInfo);

      // Restore original timeout
      (service as any).operationTimeout = originalTimeout;
    }, 1000);

  });

  describe('scanContent', () => {
    let jobContext: any;
    let command: any;
    beforeEach(() => {
      jobContext = {
        appendToErrorList: jest.fn(),
        appendToDirList: jest.fn().mockResolvedValue('dir-id'),
        dirsInfo: { lastId: '', numMessages: 0 },
        errorsInfo: { lastId: '' },
        jobConfig: { options: {}, jobType: 'type1' }
      };
      command = { commandId: 'cmd-1', fPath: 'file.txt', retryCount: 0 };
    });
    it('should handle errors when reading source directory', async () => {
      const sourceFileServer = new FileServerDetails('host', [new NFS('root')], 'user', 'password', 'domain');
      const jobConfig = new JobConfig('job1', 'type1', sourceFileServer, '/source');
      const jobContext = new TestJobContext('job1', jobConfig, 'running');

      const command: Command = {
        commandId: 'cmd-1',
        fPath: 'file.txt',
        retryCount: 0,
        ops: [],
        status: CommandStatus.IN_PROCESS,
        serialize: jest.fn()
      };

      const input: ScanContentInput = {
        excludePatterns: [], jobContext,
        sourcePath: 'source-path',
        sourcePrefix: 'source-prefix',
        targetPath: 'target-path',
        command,
        skipFile: '',
        jobRunId: 'job-1',
        errorType: ErrorType.RECOVERABLE_ERROR
      };

      jest.spyOn(fs.promises, 'readdir').mockRejectedValue(new Error('Read error'));
      const result = await service.scanContent(input);
      expect(result.error).toBe('');
      expect(jobContext.appendToErrorList).toHaveBeenCalled();
    });

    it('should handle errors when reading target directory', async () => {
      const sourceFileServer = new FileServerDetails('host', [new NFS('root')], 'user', 'password', 'domain');
      const jobConfig = new JobConfig('job1', 'type1', sourceFileServer, '/source');
      const jobContext = new TestJobContext('job1', jobConfig, 'running');

      const command: Command = {
        commandId: 'cmd-1',
        fPath: 'file.txt',
        retryCount: 0,
        ops: [],
        status: CommandStatus.IN_PROCESS,
        serialize: jest.fn()
      };

      const input: ScanContentInput = {
        excludePatterns: [],
        jobContext,
        sourcePath: 'source-path',
        sourcePrefix: 'source-prefix',
        targetPath: 'target-path',
        command,
        skipFile: '',
        jobRunId: 'job-1',
        errorType: ErrorType.RECOVERABLE_ERROR
      };

      (fs.promises.readdir as jest.Mock).mockResolvedValue(['file.txt']);
      (fs.promises.readdir as jest.Mock).mockRejectedValueOnce(new Error('Read error'));
      const result = await service.scanContent(input);
      expect(result.error).toBe('');
      expect(jobContext.appendToErrorList).toHaveBeenCalled();
    });

    it('should process files and directories correctly', async () => {
      const sourceFileServer = new FileServerDetails('host', [new NFS('root')], 'user', 'password', 'domain');
      const jobConfig = new JobConfig('job1', 'type1', sourceFileServer, '/source');
      const jobContext = new TestJobContext('job1', jobConfig, 'running');

      const command: Command = {
        commandId: 'cmd-1',
        fPath: 'file.txt',
        retryCount: 0,
        ops: [],
        status: CommandStatus.COMPLETED,
        serialize: jest.fn()
      };

      const input: ScanContentInput = {
        excludePatterns: [],
        jobContext,
        sourcePath: 'source-path',
        sourcePrefix: 'source-prefix',
        targetPath: 'target-path',
        command,
        skipFile: '',
        jobRunId: 'job-1',
        errorType: ErrorType.RECOVERABLE_ERROR
      };

      const returnValue = [
        { name: 'dir1', isDirectory: () => true } as any,
        { name: 'file.txt', isDirectory: () => false } as any,
      ];

      jest.spyOn(fs.Stats.prototype, 'isDirectory').mockReturnValue(true);
      jest.spyOn(fs.promises, 'readdir').mockResolvedValue(returnValue);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(service, 'buildCommand').mockReturnValue(command);

      const result = await service.scanContent(input);
      expect(result.directory).toBe(0);
      expect(result.command.length).toBe(0);
    });


    it('should handle error in fs.promises.lstat', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs.promises, 'readdir').mockResolvedValue(['file.txt'] as any);
      jest.spyOn(utils, 'removePrefix').mockReturnValue('file.txt');
      jest.spyOn(utils, 'shouldExcludeOrSkip').mockReturnValue(false);
      jest.spyOn(fs.promises, 'lstat').mockRejectedValueOnce(new Error('lstat error'));
      const input = {
        excludePatterns: [],
        jobContext,
        sourcePath: 'source-path',
        sourcePrefix: 'source-prefix',
        targetPath: 'target-path',
        command,
        skipFile: '',
        jobRunId: 'job-1',
        errorType: ErrorType.RECOVERABLE_ERROR
      };
      const result = await service.scanContent(input);
      expect(jobContext.appendToErrorList).toHaveBeenCalled();
      expect(result.error).toBe('');
    });

    it('should skip item if shouldExcludeOrSkip returns true', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs.promises, 'readdir').mockResolvedValue(['file.txt'] as any);
      jest.spyOn(fs.promises, 'lstat').mockResolvedValue({ isDirectory: () => false, isSymbolicLink: () => false } as any);
      jest.spyOn(utils, 'removePrefix').mockReturnValue('file.txt');
      jest.spyOn(utils, 'shouldExcludeOrSkip').mockReturnValue(true);
      const input = {
        excludePatterns: [],
        jobContext,
        sourcePath: 'source-path',
        sourcePrefix: 'source-prefix',
        targetPath: 'target-path',
        command,
        skipFile: '',
        jobRunId: 'job-1',
        errorType: ErrorType.RECOVERABLE_ERROR
      };
      const result = await service.scanContent(input);
      expect(result.files).toBe(0);
      expect(result.directory).toBe(0);
      expect(result.command.length).toBe(0);
    });

    it('should handle else branch for targetContent.has(item) and fs.existsSync false', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValueOnce(true).mockReturnValueOnce(false);
      jest.spyOn(fs.promises, 'readdir').mockResolvedValue(['file.txt'] as any);
      jest.spyOn(fs.promises, 'lstat').mockResolvedValue({ isDirectory: () => false, isSymbolicLink: () => false } as any);
      jest.spyOn(utils, 'removePrefix').mockReturnValue('file.txt');
      jest.spyOn(utils, 'shouldExcludeOrSkip').mockReturnValue(false);
      jest.spyOn(utils, 'getFileInfo').mockResolvedValue({ path: 'file.txt' });
      const input = {
        excludePatterns: [],
        jobContext,
        sourcePath: 'source-path',
        sourcePrefix: 'source-prefix',
        targetPath: 'target-path',
        command,
        skipFile: '',
        jobRunId: 'job-1',
        errorType: ErrorType.RECOVERABLE_ERROR
      };
      // targetContent has item
      jest.spyOn(service, 'getDirectoryContents').mockResolvedValueOnce(['file.txt']).mockResolvedValueOnce(['file.txt']);
      const result = await service.scanContent(input);
      expect(result.files).toBe(0);
      expect(result.command.length).toBe(0);
    });

    it('should handle else branch for targetContent.has(item) and fs.existsSync true', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs.promises, 'readdir').mockResolvedValue(['file.txt'] as any);
      jest.spyOn(fs.promises, 'lstat').mockResolvedValue({ isDirectory: () => false, isSymbolicLink: () => false } as any);
      jest.spyOn(utils, 'removePrefix').mockReturnValue('file.txt');
      jest.spyOn(utils, 'shouldExcludeOrSkip').mockReturnValue(false);
      jest.spyOn(utils, 'getFileInfo').mockResolvedValue({ path: 'file.txt' });
      jest.spyOn(service, 'buildCommand').mockReturnValue({} as any);
      jest.spyOn(fs, 'statSync').mockReturnValue({} as any);
      const input = {
        excludePatterns: [],
        jobContext,
        sourcePath: 'source-path',
        sourcePrefix: 'source-prefix',
        targetPath: 'target-path',
        command,
        skipFile: '',
        jobRunId: 'job-1',
        errorType: ErrorType.RECOVERABLE_ERROR
      };
      // targetContent has item
      jest.spyOn(service, 'getDirectoryContents').mockResolvedValueOnce(['file.txt']).mockResolvedValueOnce(['file.txt']);
      const result = await service.scanContent(input);
      expect(result.command.length).toBe(1);
    });
  });

  describe('scanPath', () => {
    let jobContext: any;
    let task: any;
    beforeEach(() => {
      jobContext = {
        jobConfig: { options: {}, jobType: 'type1' },
        appendToUpdatedTaskList: jest.fn().mockResolvedValue('id'),
        appendToErrorList: jest.fn().mockResolvedValue('id'),
        appendToTaskList: jest.fn().mockResolvedValue('id'),
        updatedTaskInfo: { lastId: '' },
        tasksInfo: { lastId: '' },
        setScanTask: jest.fn(),
        getScanTask: jest.fn(),
        deleteScanTask: jest.fn(),
        migrateTask: { lastId: '' }
      };
      task = {
        id: 'task-1',
        jobRunId: 'job-1',
        taskType: TaskType.MIGRATE,
        status: TaskStatus.PENDING,
        commands: [{ status: CommandStatus.IN_PROCESS, retryCount: 2, fPath: 'file.txt' }],
        workerId: 'worker-1',
        sPath: 'source-path',
        sPathId: 'source-path-id',
        tPathId: 'target-path-id'
      };
    });
    it('should return no task found if no task exists', async () => {
      const jobRunId = 'job-1';
      const sourceFileServer = new FileServerDetails('host', [new NFS('root')], 'user', 'password', 'domain');
      const jobConfig = new JobConfig('job1', 'type1', sourceFileServer, '/source');
      const jobContext = new TestJobContext('job1', jobConfig, 'running');

      jest.spyOn(mockRedisService, 'getJobContext').mockResolvedValue(jobContext);
      jest.spyOn(mockCommonService, 'fetchOneTask').mockResolvedValue(null);
      jest.spyOn(jobContext, 'getScanTask').mockReturnValue(null);
      jest.spyOn(jobContext, 'setScanTask').mockResolvedValue(null);
      jest.spyOn(jobContext, 'deleteScanTask').mockResolvedValue(null);

      const result = await service.scanPath({ jobRunId, failedWorkers: [] });
      expect(result.noTaskFound).toBe(true);
    });

    it('should process tasks correctly', async () => {
      const jobRunId = 'job-1';
      const sourceFileServer = new FileServerDetails('host', [new NFS('root')], 'user', 'password', 'domain');
      const jobConfig = new JobConfig('job1', 'type1', sourceFileServer, '/source');
      const jobContext: any = new TestJobContext('job1', jobConfig, 'running');
      const command: Command = {
        commandId: 'cmd-1',
        fPath: 'file.txt',
        retryCount: 0,
        ops: [],
        status: CommandStatus.IN_PROCESS,
        serialize: jest.fn()
      };

      const task: Task = {
        id: 'task-1',
        jobRunId: 'job-1',
        taskType: TaskType.MIGRATE,
        status: TaskStatus.ERRORED,
        commands: [command],
        workerId: 'worker-1',
        sPath: 'source-path',
        sPathId: 'source-path-id',
        serialize: jest.fn(),
      };

      jest.spyOn(mockRedisService, 'getJobContext').mockResolvedValue(jobContext);
      jest.spyOn(mockCommonService, 'fetchOneTask').mockResolvedValue(task);
      jest.spyOn(jobContext, 'appendToUpdatedTaskList').mockResolvedValue(null);
      jest.spyOn(jobContext, 'appendToErrorList').mockResolvedValue(null);
      jest.spyOn(service, 'scanContent').mockResolvedValue({ files: 1, directory: 0, command: [], isGeneratedTask: false, error: null });
      jobContext.updatedTaskInfo = { lastId: '0-0' };
      jest.spyOn(jobContext, 'getScanTask').mockReturnValue(null);
      jest.spyOn(jobContext, 'setScanTask').mockResolvedValue(null);
      jest.spyOn(jobContext, 'deleteScanTask').mockResolvedValue(null);

      const result = await service.scanPath({ jobRunId, failedWorkers: [] });
      expect(result.success).toBe(1);
      expect(result.files).toBe(1);
      expect(result.folders).toBe(0);
    });

    it('should handle errors during task processing', async () => {
      const jobRunId = 'job-1';
      const jobContext = {
        jobConfig: { options: {} }, appendToUpdatedTaskList: jest.fn(), updatedTaskInfo: { lastId: '0-0' }, appendToErrorList: jest.fn(), getJobState: jest.fn().mockReturnValue({
          workers: [],
          tasks_completed: 1,
          tasks_total: 2,
          workers_agreed: [],
          status: 'RUNNING',
          failedWorkers: []
        }), getScanTask: jest.fn(), setScanTask: jest.fn(), deleteScanTask: jest.fn()
      } as unknown as JobContext;
      const sourceFileServer = new FileServerDetails('host', [new NFS('root')], 'user', 'password', 'domain');
      const jobConfig = new JobConfig('job1', 'type1', sourceFileServer, '/source');
      const task = { commands: [{ status: CommandStatus.IN_PROCESS, fPath: 'file.txt' }] };
      mockRedisService.getJobContext = jest.fn().mockResolvedValue(jobContext);
      mockCommonService.fetchOneTask = jest.fn().mockResolvedValue(task);
      jest.spyOn(service, 'scanContent').mockResolvedValue({ files: 0, directory: 0, command: [], isGeneratedTask: false, error: 'some-error' });
      jest.spyOn(jobContext, 'getScanTask').mockReturnValue(null);

      const result = await service.scanPath({ jobRunId: 'job1', failedWorkers: [] });
      expect(result.error).toBe(1);
      expect(result.errors.size).toBe(1);
    });

    it('Should handle if the worker is already failed', async () => {
      const jobRunId = 'job-1';
      const sourceFileServer = new FileServerDetails('host', [new NFS('root')], 'user', 'password', 'domain');
      const jobConfig = new JobConfig('job1', 'type1', sourceFileServer, '/source');
      const jobContext = new TestJobContext('job1', jobConfig, 'running');

      jest.spyOn(mockRedisService, 'getJobContext').mockResolvedValue(jobContext);
      jest.spyOn(mockCommonService, 'fetchOneTask').mockResolvedValue(null);
      jest.spyOn(jobContext, 'getScanTask').mockReturnValue(null);
      jest.spyOn(jobContext, 'setScanTask').mockResolvedValue(null);
      jest.spyOn(jobContext, 'deleteScanTask').mockResolvedValue(null);

      const result = await service.scanPathActivity({ jobRunId, failedWorkers: ['test-worker-id'] });
      expect(result.noTaskFound).toBe(true);
    });


    it('should set task.status=ERRORED if scanPath.error > 0 && scanPath.retryCount >= maxRetryCount', async () => {
      jest.spyOn(service, 'scanContent').mockResolvedValue({ files: 0, directory: 0, command: [], isGeneratedTask: false, error: 'err', errorType: ErrorType.RECOVERABLE_ERROR });
      jest.spyOn(service['redisService'], 'getJobContext').mockResolvedValue(jobContext);
      jest.spyOn(service['commonService'], 'fetchOneTask').mockResolvedValue(task);
      jobContext.getScanTask = jest.fn().mockReturnValue(null);
      jobContext.setScanTask = jest.fn();
      jobContext.deleteScanTask = jest.fn();
      (service as any).maxRetryCount = 2;
      const result = await service.scanPathActivity({ jobRunId: 'job-1', failedWorkers: [] });
      expect(result.error).toBe(1);
      expect(task.status).toBe(TaskStatus.ERRORED);
    });

    it('should set task.status=COMPLETED_WITH_ERROR if scanPath.retryCount > 0', async () => {
      jest.spyOn(service, 'scanContent').mockResolvedValue({ files: 0, directory: 0, command: [], isGeneratedTask: false, error: null, errorType: ErrorType.RECOVERABLE_ERROR });
      jest.spyOn(service['redisService'], 'getJobContext').mockResolvedValue(jobContext);
      jest.spyOn(service['commonService'], 'fetchOneTask').mockResolvedValue(task);
      jobContext.getScanTask = jest.fn().mockReturnValue(null);
      jobContext.setScanTask = jest.fn();
      jobContext.deleteScanTask = jest.fn();
      task.commands[0].retryCount = 1;
      const result = await service.scanPathActivity({ jobRunId: 'job-1', failedWorkers: [] });
      expect(task.status).toBe(TaskStatus.COMPLETED_WITH_ERROR);
    });

    it('should set task.status=COMPLETED if no errors', async () => {
      jest.spyOn(service, 'scanContent').mockResolvedValue({ files: 0, directory: 0, command: [], isGeneratedTask: false, error: null, errorType: ErrorType.RECOVERABLE_ERROR });
      jest.spyOn(service['redisService'], 'getJobContext').mockResolvedValue(jobContext);
      jest.spyOn(service['commonService'], 'fetchOneTask').mockResolvedValue(task);
      jobContext.getScanTask = jest.fn().mockReturnValue(null);
      jobContext.setScanTask = jest.fn();
      jobContext.deleteScanTask = jest.fn();
      task.commands[0].retryCount = 0;
      const result = await service.scanPathActivity({ jobRunId: 'job-1', failedWorkers: [] });
      expect(task.status).toBe(TaskStatus.COMPLETED);
    });

    it('should handle scanPath.error > 0 and isFatalError returns true', async () => {
      jest.spyOn(service, 'scanContent').mockResolvedValue({ files: 0, directory: 0, command: [], isGeneratedTask: false, error: 'fatal', errorType: ErrorType.RECOVERABLE_ERROR });
      jest.spyOn(service['redisService'], 'getJobContext').mockResolvedValue(jobContext);
      jest.spyOn(service['commonService'], 'fetchOneTask').mockResolvedValue(task);
      jest.spyOn(utils, 'isFatalError').mockReturnValue(true);
      jobContext.getScanTask = jest.fn().mockReturnValue(null);
      jobContext.setScanTask = jest.fn();
      jobContext.deleteScanTask = jest.fn();
      (service as any).maxRetryCount = 2;
      const result = await service.scanPathActivity({ jobRunId: 'job-1', failedWorkers: [] });
      expect(result.isFatal).toBe(true);
      expect(task.status).toBe(TaskStatus.ERRORED);
    });

    it('should handle scanPath.error > 0 and isFatalError returns false, errorType=TRANSIENT_ERROR', async () => {
      jest.spyOn(service, 'scanContent').mockResolvedValue({ files: 0, directory: 0, command: [], isGeneratedTask: false, error: 'err', errorType: ErrorType.RECOVERABLE_ERROR });
      jest.spyOn(service['redisService'], 'getJobContext').mockResolvedValue(jobContext);
      jest.spyOn(service['commonService'], 'fetchOneTask').mockResolvedValue(task);
      jest.spyOn(utils, 'isFatalError').mockReturnValue(false);
      jobContext.getScanTask = jest.fn().mockReturnValue(null);
      jobContext.setScanTask = jest.fn();
      jobContext.deleteScanTask = jest.fn();
      (service as any).maxRetryCount = 2;
      task.commands[0].retryCount = 1;
      const result = await service.scanPathActivity({ jobRunId: 'job-1', failedWorkers: [] });
      expect(task.status).toBe(TaskStatus.ERRORED);
    });

    it('should handle scanPath.retryCount < maxRetryCount and !scanPath.isFatal', async () => {
      jest.spyOn(service, 'scanContent').mockResolvedValue({ files: 0, directory: 0, command: [], isGeneratedTask: false, error: 'err', errorType: ErrorType.RECOVERABLE_ERROR });
      jest.spyOn(service['redisService'], 'getJobContext').mockResolvedValue(jobContext);
      jest.spyOn(service['commonService'], 'fetchOneTask').mockResolvedValue(task);
      jest.spyOn(utils, 'isFatalError').mockReturnValue(false);
      jobContext.getScanTask = jest.fn().mockReturnValue(null);
      jobContext.setScanTask = jest.fn();
      jobContext.deleteScanTask = jest.fn();
      (service as any).maxRetryCount = 5;
      task.commands[0].retryCount = 1;
      const loggerSpy = jest.spyOn(service['logger'], 'debug');
      await service.scanPathActivity({ jobRunId: 'job-1', failedWorkers: [] });
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('Appending to Retry'));
    });

    it('should handle scanPath.isFatal', async () => {
      jest.spyOn(service, 'scanContent').mockResolvedValue({ files: 0, directory: 0, command: [], isGeneratedTask: false, error: 'fatal', errorType: ErrorType.RECOVERABLE_ERROR });
      jest.spyOn(service['redisService'], 'getJobContext').mockResolvedValue(jobContext);
      jest.spyOn(service['commonService'], 'fetchOneTask').mockResolvedValue(task);
      jest.spyOn(utils, 'isFatalError').mockReturnValue(true);
      jobContext.getScanTask = jest.fn().mockReturnValue(null);
      jobContext.setScanTask = jest.fn();
      jobContext.deleteScanTask = jest.fn();
      (service as any).maxRetryCount = 2;
      const loggerSpy = jest.spyOn(service['logger'], 'debug');
      await service.scanPathActivity({ jobRunId: 'job-1', failedWorkers: [] });
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('Fatal Error Detected'));
    });

    it('should handle else branch (no errors)', async () => {
      jest.spyOn(service, 'scanContent').mockResolvedValue({ files: 0, directory: 0, command: [], isGeneratedTask: false, error: null, errorType: ErrorType.RECOVERABLE_ERROR });
      jest.spyOn(service['redisService'], 'getJobContext').mockResolvedValue(jobContext);
      jest.spyOn(service['commonService'], 'fetchOneTask').mockResolvedValue(task);
      jobContext.getScanTask = jest.fn().mockReturnValue(null);
      jobContext.setScanTask = jest.fn();
      jobContext.deleteScanTask = jest.fn();
      const loggerSpy = jest.spyOn(service['logger'], 'debug');
      await service.scanPathActivity({ jobRunId: 'job-1', failedWorkers: [] });
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('Completed Task'));
    });
  });

  describe('buildCommand', () => {
    it('should build a command if content is updated', () => {
      const sFile = { size: 100, mtime: new Date(), isDirectory: () => false };
      const fPath = 'file.txt';
      const command: any = service.buildCommand(sFile as any, fPath);
      expect(command).toBeDefined();
      expect(command.ops[0].cmd).toBe('cc');
    });

    it('should return undefined if content is not updated', () => {
      const sFile = { size: 100, mtime: new Date(), isDirectory: () => false };
      const dFile = { size: 100, mtime: new Date(), isDirectory: () => false };
      const command = service.buildCommand(sFile as any, 'file.txt', dFile as any);
      expect(command).toBeUndefined();
    });
  });
  describe('publishMigrationTask', () => {
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
    it('Should publish migration task successfully', async () => {
      jest.spyOn(utils, 'buildTask').mockReturnValue({
        type: 'SCAN',
        jobRunId: 'job-123',
        jobContext: mockedJobContext,
      } as any);
      const result = await service.publishMigrationTask({ jobContext: mockedJobContext, commands: [] } as any);
    });

    it('should call buildTask and appendToMigrationTask in publishMigrationTask', async () => {
      const mockJobContext = {
        jobRunId: 'run-1',
        migrateTask: { lastId: '' },
        appendToMigrationTask: jest.fn().mockResolvedValue('new-last-id'),
      };
      const mockCommands = [{}, {}];
      jest.spyOn(utils, 'buildTask').mockReturnValue({ id: 'task-1', status: 'READY', commands: mockCommands } as any);
      await service.publishMigrationTask({ jobContext: mockJobContext as any, commands: mockCommands as any });
      expect(utils.buildTask).toHaveBeenCalled();
      expect(mockJobContext.appendToMigrationTask).toHaveBeenCalled();
      expect(mockJobContext.migrateTask.lastId).toBe('new-last-id');
      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it('should handle scanContent errors in for loop gracefully', async () => {
      const jobContext = {
        appendToErrorList: jest.fn(),
        appendToDirList: jest.fn(),
        dirsInfo: { lastId: '', numMessages: 0 },
        errorsInfo: { lastId: '' },
        jobConfig: { options: {}, jobType: 'type1' }
      };
      const command = { commandId: 'cmd-1', fPath: 'file.txt', retryCount: 0 };
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs.promises, 'lstat').mockRejectedValueOnce(new Error('lstat error'));
      jest.spyOn(fs.promises, 'readdir').mockResolvedValue(['file.txt'] as any);
      jest.spyOn(utils, 'removePrefix').mockReturnValue('file.txt');
      jest.spyOn(utils, 'shouldExcludeOrSkip').mockReturnValue(false);
      const input: ScanContentInput = {
        excludePatterns: [],
        jobContext: jobContext as any,
        sourcePath: 'source-path',
        sourcePrefix: 'source-prefix',
        targetPath: 'target-path',
        command: command as any,
        skipFile: '',
        jobRunId: 'job-1',
        errorType: ErrorType.RECOVERABLE_ERROR
      };
      const result = await service.scanContent(input);
      expect(jobContext.appendToErrorList).toHaveBeenCalled();
      expect(result.error).toBe('');
    });

    it('should skip items if shouldExcludeOrSkip returns true', async () => {
      const jobContext = {
        appendToErrorList: jest.fn(),
        appendToDirList: jest.fn(),
        dirsInfo: { lastId: '', numMessages: 0 },
        errorsInfo: { lastId: '' },
        jobConfig: { options: {}, jobType: 'type1' }
      };
      const command = { commandId: 'cmd-1', fPath: 'file.txt', retryCount: 0 };
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs.promises, 'lstat').mockResolvedValue({ isDirectory: () => false, isSymbolicLink: () => false } as any);
      jest.spyOn(fs.promises, 'readdir').mockResolvedValue(['file.txt'] as any);
      jest.spyOn(utils, 'removePrefix').mockReturnValue('file.txt');
      jest.spyOn(utils, 'shouldExcludeOrSkip').mockReturnValue(true);
      const input: ScanContentInput = {
        excludePatterns: [],
        jobContext: jobContext as any,
        sourcePath: 'source-path',
        sourcePrefix: 'source-prefix',
        targetPath: 'target-path',
        command: command as any,
        skipFile: '',
        jobRunId: 'job-1',
        errorType: ErrorType.RECOVERABLE_ERROR
      };
      const result = await service.scanContent(input);
      expect(result.files).toBe(0);
      expect(result.directory).toBe(0);
      expect(result.command.length).toBe(0);
    });
  })
});