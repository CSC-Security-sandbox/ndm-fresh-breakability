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

jest.mock('@temporalio/activity', () => ({
  Context: {
      current: jest.fn().mockResolvedValue(()=>({
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
  consumerGroupCount:2,
  readAndPurge: jest.fn(),
  getLength: jest.fn(),
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
    async init() {}
    async close() {}
    async cleanup() {}
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
    it('should return an empty array if the directory does not exist', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      const result = await service.getDirectoryContents('non-existent-path');
      expect(result).toEqual([]);
    });

    it('should return directory contents if the directory exists', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      const returnValue = [
        { name: 'file1.txt', isDirectory: () => false } as any,
        { name: 'file2.txt', isDirectory: () => false } as any,
      ];

      jest.spyOn(fs.promises, 'readdir').mockResolvedValue(returnValue);
      const result = await service.getDirectoryContents('existing-path');
      expect(result).toEqual(returnValue);
    });
  });

  describe('scanContent', () => {
    it('should handle errors when reading source directory', async () => {
      const sourceFileServer = new FileServerDetails('host', [ new NFS('root') ], 'user', 'password', 'domain');
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
      const sourceFileServer = new FileServerDetails('host', [ new NFS('root') ], 'user', 'password', 'domain');
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
      const sourceFileServer = new FileServerDetails('host', [ new NFS('root') ], 'user', 'password', 'domain');
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
  });

  describe('scanPath', () => {
    it('should return no task found if no task exists', async () => {
      const jobRunId = 'job-1';
      const sourceFileServer = new FileServerDetails('host', [ new NFS('root') ], 'user', 'password', 'domain');
      const jobConfig = new JobConfig('job1', 'type1', sourceFileServer, '/source');
      const jobContext = new TestJobContext('job1', jobConfig, 'running');

      jest.spyOn(mockRedisService, 'getJobContext').mockResolvedValue(jobContext);
      jest.spyOn(mockCommonService, 'fetchOneTask').mockResolvedValue(null);
      jest.spyOn(jobContext, 'getScanTask').mockReturnValue(null);
      jest.spyOn(jobContext, 'setScanTask').mockResolvedValue(null);
      jest.spyOn(jobContext, 'deleteScanTask').mockResolvedValue(null);
      
      const result = await service.scanPath({ jobRunId , failedWorkers: [] });
      expect(result.noTaskFound).toBe(true);
    });

    it('should process tasks correctly', async () => {
      const jobRunId = 'job-1';
      const sourceFileServer = new FileServerDetails('host', [ new NFS('root') ], 'user', 'password', 'domain');
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

      const result = await service.scanPath({ jobRunId,  failedWorkers: [] });
      expect(result.success).toBe(1);
      expect(result.files).toBe(1);
      expect(result.folders).toBe(0);
    });

    it('should handle errors during task processing', async () => {
      const jobRunId = 'job-1';
      const jobContext = { jobConfig: { options: {} }, appendToUpdatedTaskList: jest.fn(), updatedTaskInfo: { lastId: '0-0' }, appendToErrorList: jest.fn() ,  getJobState: jest.fn().mockReturnValue({
        workers: [],
        tasks_completed: 1,
        tasks_total: 2,
        workers_agreed: [],
        status: 'RUNNING',
        failedWorkers: []
    }), getScanTask: jest.fn(), setScanTask: jest.fn(), deleteScanTask: jest.fn() } as unknown as JobContext;
      const sourceFileServer = new FileServerDetails('host', [ new NFS('root') ], 'user', 'password', 'domain');
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
  });

  describe('buildCommand', () => {
    it('should build a command if content is updated', () => {
      const sFile = { size: 100, mtime: new Date(), isDirectory: () => false };
      const fPath = 'file.txt';
      const command:any = service.buildCommand(sFile as any, fPath);
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
});