import { Test, TestingModule } from '@nestjs/testing';
import { MigrationScanService } from './migrate.scan.service';
import { ConfigService } from '@nestjs/config';
import { RedisService } from 'src/redis/redis.service';
import { CommonActivityService } from '../common/common.service';
import { Command, CommandStatus, FileServerDetails, JobContext, Logger, TaskStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import * as fs from 'fs';
import * as path from 'path';
import { JobState } from '@netapp-cloud-datamigrate/jobs-lib/dist/types/job-state';

jest.mock('fs');
jest.mock('src/redis/redis.service');
jest.mock('../common/common.service');

describe('MigrationScanService', () => {
  let service: MigrationScanService;
  let mockConfigService: Partial<ConfigService>;
  let mockRedisService: Partial<RedisService>;
  let mockCommonService: Partial<CommonActivityService>;
  let mockLogger: { debug: jest.Mock };

  beforeEach(async () => {
    mockLogger = { debug: jest.fn() };
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
        { provide: RedisService, useValue: mockRedisService },
        { provide: CommonActivityService, useValue: mockCommonService },
        { provide: Logger, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<MigrationScanService>(MigrationScanService);
  });

  describe('getDirectoryContents', () => {
    it('should return an empty array if the directory does not exist', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const result = await service.getDirectoryContents('non-existent-path');
      expect(result).toEqual([]);
    });

    it('should return directory contents if the directory exists', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.promises.readdir as jest.Mock).mockResolvedValue(['file1.txt', 'file2.txt']);
      const result = await service.getDirectoryContents('existing-path');
      expect(result).toEqual(['file1.txt', 'file2.txt']);
    });
  });

  describe('scanContent', () => {
    it('should handle errors when reading source directory', async () => {
      const jobContext: JobContext = {
        jobConfig: {
          options: {},
          jobId: 'job-1',
          jobType: 'someJobType',
          sourceFileServer: {
            hostname: '',
            protocols: [],
            password: '',
            pathId: '',
            username: '',
            path: '',
            workingDirectory: '',
            protocolVersion: '',
            serialize: function (): string {
              return '';
            },
            deserialize: function (json: string): void {}
          },
          sourcePath: '',
          serialize: function (): string {
            return '';
          },
          deserialize: function (json: string): void {}
        },
        jobRunId: 'job-1',
        jobState: JobState,
        jobRunStatus: 'someStatus',
        errorsInfo: { jobRunId: 'job-1', streamKey: '', numMessages: 0, lastId: '', errors: [] },
        appendToErrorList: jest.fn(),
        appendToDirList: jest.fn(),
      };

      const command = { 
        commandId: 'cmd-1', 
        fPath: 'file.txt', 
        retryCount: 0,
        ops: [],
        status: CommandStatus.IN_PROCESS,
        serialize: () => ({ fPath: 'file.txt' })
      };

      const input = {
        excludePatterns: [],
        jobContext,
        sourcePath: 'source-path',
        sourcePrefix: 'source-prefix',
        targetPath: 'target-path',
        command,
        skipFile: '',
        jobRunId: 'job-1',
      };

      (fs.promises.readdir as jest.Mock).mockRejectedValue(new Error('Read error'));
      const result = await service.scanContent(input);
      expect(result.error).toBe('');
      expect(jobContext.appendToErrorList).toHaveBeenCalled();
    });

    it('should handle errors when reading target directory', async () => {
      const jobContext: JobContext = {
        jobConfig: {
          options: {},
          jobId: '',
          jobType: '',
          sourceFileServer: {
            hostname: '',
            protocols: [],
            password: '',
            pathId: '',
            username: '',
            path: '',
            workingDirectory: '',
            protocolVersion: '',
            serialize: function (): string {
              throw new Error('Function not implemented.');
            },
            deserialize: function (json: string): void {
              throw new Error('Function not implemented.');
            }
          },
          sourcePath: '',
          serialize: function (): string {
            throw new Error('Function not implemented.');
          },
          deserialize: function (json: string): void {
            throw new Error('Function not implemented.');
          }
        },
        jobRunId: 'job-1',
        jobState: 'someState',
        jobRunStatus: 'someStatus',
        errorsInfo: [],
        appendToErrorList: jest.fn(),
        appendToDirList: jest.fn(),
      };

      const command = { 
        commandId: 'cmd-1', 
        fPath: 'file.txt', 
        retryCount: 0,
        ops: [],
        status: CommandStatus.IN_PROCESS,
        serialize: () => ({ fPath: 'file.txt' })
      };

      const input = {
        excludePatterns: [],
        jobContext,
        sourcePath: 'source-path',
        sourcePrefix: 'source-prefix',
        targetPath: 'target-path',
        command,
        skipFile: '',
        jobRunId: 'job-1',
      };

      (fs.promises.readdir as jest.Mock).mockResolvedValue(['file.txt']);
      (fs.promises.readdir as jest.Mock).mockRejectedValueOnce(new Error('Read error'));
      const result = await service.scanContent(input);
      expect(result.error).toBe('');
      expect(jobContext.appendToErrorList).toHaveBeenCalled();
    });

    it('should process files and directories correctly', async () => {
      const jobContext: JobContext = {
        jobConfig: {
          options: {},
          jobId: '',
          jobType: '',
          sourceFileServer: new FileServerDetails,
          sourcePath: '',
          serialize: function (): string {
            throw new Error('Function not implemented.');
          },
          deserialize: function (json: string): void {
            throw new Error('Function not implemented.');
          }
        },
        jobRunId: 'job-1',
        jobState: 'someState',
        jobRunStatus: 'someStatus',
        errorsInfo: [],
        appendToErrorList: jest.fn(),
        appendToDirList: jest.fn(),
      };

      const command = { 
        commandId: 'cmd-1', 
        fPath: 'file.txt', 
        retryCount: 0,
        ops: [],
        status: CommandStatus.IN_PROCESS,
        serialize: () => ({ fPath: 'file.txt' })
      };

      const input = {
        excludePatterns: [],
        jobContext,
        sourcePath: 'source-path',
        sourcePrefix: 'source-prefix',
        targetPath: 'target-path',
        command,
        skipFile: '',
        jobRunId: 'job-1',
      };

      (fs.promises.readdir as jest.Mock).mockResolvedValue(['dir1', 'file1.txt']);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.promises.lstat as jest.Mock).mockResolvedValue({ isDirectory: () => true });
      (service.buildCommand as jest.Mock).mockReturnValue(new Command('file1.txt', {}, 'uuid', 0).serialize());

      const result = await service.scanContent(input);
      expect(result.files).toBe(1);
      expect(result.directory).toBe(1);
      expect(result.command.length).toBe(1);
    });
  });

  describe('scanPath', () => {
    it('should return no task found if no task exists', async () => {
      const jobRunId = 'job-1';
      const jobContext: JobContext = {
        jobConfig: {
          options: {},
          jobId: 'job-1',
          jobType: 'someJobType',
          sourceFileServer: {
            hostname: '',
            protocols: [],
            password: '',
            pathId: '',
            username: '',
            path: '',
            workingDirectory: '',
            protocolVersion: '',
            serialize: function (): string {
              return '';
            },
            deserialize: function (json: string): void {}
          },
          sourcePath: '',
          serialize: function (): string {
            return '';
          },
          deserialize: function (json: string): void {}
        },
        jobRunId: jobRunId,
        jobState: JobState.RUNNING,
        jobRunStatus: 'someStatus',
        errorsInfo: { jobRunId: 'job-1', streamKey: '', numMessages: 0, lastId: '', errors: [] },
        appendToUpdatedTaskList: jest.fn(),
      };

      jest.spyOn(mockRedisService, 'getJobContext').mockResolvedValue(jobContext);
      jest.spyOn(mockCommonService, 'fetchOneTask').mockResolvedValue(null);

      const result = await service.scanPath({ jobRunId });
      expect(result.noTaskFound).toBe(true);
    });

    it('should process tasks correctly', async () => {
      const jobRunId = 'job-1';
      const jobContext: JobContext = {
        jobConfig: {
          options: {},
          jobId: 'job-1',
          jobType: 'someJobType',
          sourceFileServer: {
            hostname: '',
            protocols: [],
            password: '',
            pathId: '',
            username: '',
            path: '',
            workingDirectory: '',
            protocolVersion: '',
            serialize: function (): string {
              return '';
            },
            deserialize: function (json: string): void {}
          },
          sourcePath: '',
          serialize: function (): string {
            return '';
          },
          deserialize: function (json: string): void {}
        },
        jobRunId: jobRunId,
        jobRunStatus: 'someStatus',
        appendToUpdatedTaskList: jest.fn(),
      };

      const task = { 
        id: 'task-1', 
        jobRunId: 'job-1', 
        taskType: 'someTaskType', 
        status: TaskStatus.ERRORED,
        commands: [{ status: CommandStatus.IN_PROCESS, fPath: 'file.txt' }],
      };

      jest.spyOn(mockRedisService, 'getJobContext').mockResolvedValue(jobContext);
      jest.spyOn(mockCommonService, 'fetchOneTask').mockResolvedValue(task);
      jest.spyOn(service, 'scanContent').mockResolvedValue({ files: 1, directory: 0, command: [], isGeneratedTask: false, error: null });

      const result = await service.scanPath({ jobRunId });
      expect(result.success).toBe(1);
      expect(result.files).toBe(1);
      expect(result.folders).toBe(0);
    });

    it('should handle errors during task processing', async () => {
      const jobRunId = 'job-1';
      const jobContext = { jobConfig: { options: {} }, appendToUpdatedTaskList: jest.fn() };
      const task = { commands: [{ status: CommandStatus.IN_PROCESS, fPath: 'file.txt' }] };
      mockRedisService.getJobContext = jest.fn().mockResolvedValue(jobContext);
      mockCommonService.fetchOneTask = jest.fn().mockResolvedValue(task);
      (service.scanContent as jest.Mock).mockResolvedValue({ files: 0, directory: 0, command: [], isGeneratedTask: false, error: 'some-error' });

      const result = await service.scanPath({ jobRunId });
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
      expect(command.cmd[0].cmd).toBe('COPY_CONTENT');
    });

    it('should return undefined if content is not updated', () => {
      const sFile = { size: 100, mtime: new Date(), isDirectory: () => false };
      const dFile = { size: 100, mtime: new Date(), isDirectory: () => false };
      const command = service.buildCommand(sFile as any, 'file.txt', dFile as any);
      expect(command).toBeUndefined();
    });
  });
}); 