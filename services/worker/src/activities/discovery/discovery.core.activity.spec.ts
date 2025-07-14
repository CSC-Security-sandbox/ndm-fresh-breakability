
import { ConfigService } from '@nestjs/config';
import { CommandStatus, TaskStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import { RedisService } from 'src/redis/redis.service';
import { CommonActivityService } from '../common/common.service';
import * as utils from '../utils/utils';
import { DiscoveryScanActivity } from './discovery.core.activity';
import { Dirent } from 'fs';
import * as fs from 'fs';
import { ScanDirCommandInput } from './discovery.type';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';

jest.mock('@temporalio/activity', () => ({
  Context: {
    current: jest.fn().mockResolvedValue(() => ({
      heartbeat: jest.fn(),
    }))
  },
}))

jest.mock('@temporalio/activity', () => ({
  Context: {
    current: jest.fn(),
  },
}));

describe('DiscoveryScanActivity', () => {
  let service: DiscoveryScanActivity;
  let basePrefixSpy: jest.SpyInstance;

  const mockLoggerInstance: LoggerService = {
    log: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    requestContext: {} as any,
    parentContext: {} as any,
    setParentContext: jest.fn(),
  } as unknown as LoggerService;

  const mockLoggerFactory = {
    create: jest.fn().mockReturnValue(mockLoggerInstance),
  } as unknown as LoggerFactory;

  const mockRedis = { getJobContext: jest.fn(), setJobContext: jest.fn() } as any as RedisService;
  const mockCommon = { fetchOneTask: jest.fn(), addFailedWorkerToJobState: jest.fn() } as any as CommonActivityService;
  const mockConfig = { get: jest.fn() } as any as ConfigService;

  beforeEach(() => {
    jest.resetAllMocks();
    mockConfig.get = jest.fn().mockImplementation((key: string) => {
      switch (key) {
        case 'worker.maxRetryCount': return 2;
        case 'worker.workerId': return 'worker-1';
        case 'worker.maxCommandConcurrency': return 1;
        default: return null;
      }
    });

    mockLoggerFactory.create = jest.fn().mockReturnValue(mockLoggerInstance);

    service = new DiscoveryScanActivity(mockLoggerFactory, mockRedis, mockConfig, mockCommon);
    basePrefixSpy = jest.spyOn(utils, 'basePrefix').mockReturnValue('/base/');

    // Mock utils
    jest.spyOn(utils, 'shouldExcludeOrSkip').mockReturnValue(false);
    jest.spyOn(utils, 'removePrefix').mockImplementation((path, prefix) => path.replace(prefix, ''));
    jest.spyOn(utils, 'getFileInfo').mockImplementation(async ({ name, fullFilePath, relativePath }) => ({ name, fullFilePath, relativePath } as any));
    jest.spyOn(utils, 'dmError').mockImplementation(() => ({ error: 'err' } as any));
    jest.spyOn(utils, 'isFatalError').mockReturnValue(false);
  });

  describe('scanActivity - no task found', () => {
    it('should return noTaskFound when no task is fetched', async () => {
      mockRedis.getJobContext = jest.fn().mockResolvedValue({
        appendToUpdatedTaskList: jest.fn(),
        jobConfig: {},
        getScanTask: jest.fn(),
        setScanTask: jest.fn(),
        deleteScanTask: jest.fn(),
        getJobState: () => ({ failedWorkers: [] }), updatedTaskInfo: {},
      });
      mockCommon.fetchOneTask = jest.fn().mockResolvedValue(null);

      const result = await service.scanActivity({ jobRunId: 'job1', failedWorkers: [] });
      expect(result.noTaskFound).toBe(true);
      expect(result.files).toBe(0);
      expect(result.folders).toBe(0);
    });
  });

  describe('scanActivity - with successful discovery', () => {
    it('should process and update counts', async () => {
      const fakeTask = { id: 'task1', commands: [{ status: CommandStatus.IN_PROCESS }], jobRunId: 'job1' };
      const jobContext: any = {
        getJobState: () => ({ failedWorkers: [] }),
        updatedTaskInfo: { lastId: '' },
        appendToUpdatedTaskList: jest.fn().mockResolvedValue('upd1'),
        appendToTaskList: jest.fn(),
        setJobConfig: {} as any,
        jobConfig: { sourceFileServer: { pathId: 'p1' }, options: {} },
        getScanTask: jest.fn(),
        setScanTask: jest.fn(),
        deleteScanTask: jest.fn(),
      };
      mockRedis.getJobContext = jest.fn().mockResolvedValue(jobContext);
      mockCommon.fetchOneTask = jest.fn().mockResolvedValue(fakeTask);

      // Spy on discover
      const discoverOutput = { isFatal: false, files: 2, folders: 1, errors: new Set(), success: 1 };
      jest.spyOn(service, 'discover').mockResolvedValue(discoverOutput as any);

      const result = await service.scanActivity({ jobRunId: 'job1', failedWorkers: [] });
      expect(result.files).toBe(2);
      expect(result.folders).toBe(1);
      expect(result.isFatalErrored).toBe(false);
    });

    it('should add failed worker on fatal', async () => {
      const fakeTask = { id: 'task1', commands: [{ status: CommandStatus.IN_PROCESS }], jobRunId: 'job1' };
      const jobContext: any = {
        getJobState: () => ({ failedWorkers: [] }),
        updatedTaskInfo: { lastId: '' },
        appendToUpdatedTaskList: jest.fn().mockResolvedValue('upd1'),
        appendToTaskList: jest.fn(),
        jobConfig: { sourceFileServer: { pathId: 'p1' }, options: {} },
        getScanTask: jest.fn(),
        setScanTask: jest.fn(),
        deleteScanTask: jest.fn(),
      };
      mockRedis.getJobContext = jest.fn().mockResolvedValue(jobContext);
      mockCommon.fetchOneTask = jest.fn().mockResolvedValue(fakeTask);

      const discoverOutput = { isFatal: true, files: 0, folders: 0, errors: new Set(), success: 0 };
      jest.spyOn(service, 'discover').mockResolvedValue(discoverOutput as any);

      const result = await service.scanActivity({ jobRunId: 'job1', failedWorkers: [] });
      expect(result.isFatalErrored).toBe(true);
    });

    it('Should handle if worker is already failed', async () => {
      const fakeTask = { id: 'task1', commands: [{ status: CommandStatus.IN_PROCESS }], jobRunId: 'job1' };
      const jobContext: any = {
        getJobState: () => ({ failedWorkers: ['worker-1'] }),
        updatedTaskInfo: { lastId: '' },
        appendToUpdatedTaskList: jest.fn().mockResolvedValue('upd1'),
        appendToTaskList: jest.fn(),
        jobConfig: { sourceFileServer: { pathId: 'p1' }, options: {} },
        getScanTask: jest.fn(),
        setScanTask: jest.fn(),
        deleteScanTask: jest.fn(),
      };
      mockRedis.getJobContext = jest.fn().mockResolvedValue(jobContext);
      mockCommon.fetchOneTask = jest.fn().mockResolvedValue(fakeTask);

      const result = await service.scanActivity({ jobRunId: 'job1', failedWorkers: ['worker-1'] });
      expect(result.noTaskFound).toBe(true);
    });

    it('Should log Discovery Scan Activity ERRORED', async () => {
      const fakeTask = { id: 'task1', commands: [{ status: CommandStatus.IN_PROCESS }], jobRunId: 'job1' };
      const jobContext: any = {
        getJobState: () => ({ failedWorkers: [] }),
        updatedTaskInfo: { lastId: '' },
        appendToUpdatedTaskList: jest.fn().mockResolvedValue('upd1'),
        appendToTaskList: jest.fn(),
        jobConfig: { sourceFileServer: { pathId: 'p1' }, options: {} },
        getScanTask: jest.fn(),
        setScanTask: jest.fn(),
        deleteScanTask: jest.fn(),
      };
      mockRedis.getJobContext = jest.fn().mockResolvedValue(jobContext);
      mockCommon.fetchOneTask = jest.fn().mockResolvedValue(fakeTask);
      // Simulate an error in discover
      jest.spyOn(service, 'discover').mockResolvedValue({ isFatal: false, files: 0, folders: 0, errors: new Set('Test error'), success: 0 } as any);
      await service.scanActivity({ jobRunId: 'job1', failedWorkers: [] });
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(expect.stringContaining('[job1] Discovery Scan Activity ERRORED.'));
    });
  });

  describe('discover', () => {
    it('should mark task completed when no errors', async () => {
      const task: any = { id: 't1', commands: [{ fPath: '/a', status: CommandStatus.IN_PROCESS, retryCount: 0, commandId: 'c1' }], jobRunId: 'job1' };
      const jobContext: any = {
        jobRunId: 'job1',
        jobConfig: { sourceFileServer: { pathId: 'p1' }, options: {} }, updatedTaskInfo: { lastId: '1' }, dirsInfo: { lastId: '', numMessages: 0 },
        appendToDirList: jest.fn(),
        appendToFileList: jest.fn(),
        appendToErrorList: jest.fn(),
        errorsInfo: { lastId: '' },
        appendToUpdatedTaskList: jest.fn(),
        appendToTaskList: jest.fn(),
        getScanTask: jest.fn(),
        setScanTask: jest.fn(),
        deleteScanTask: jest.fn()
      };
      // Mock scanDirCommand success
      jest.spyOn(service, 'scanDirCommand').mockResolvedValue({ files: 1, directory: 1, error: undefined } as any);

      const result = await service.discover({ task, jobContext } as any);
      expect(result.error).toBe(0);
      expect(result.success).toBe(1);
      expect(task.status).toBe(TaskStatus.COMPLETED);
    });

    it('should retry and record errors', async () => {
      const task: any = { id: 't2', commands: [{ fPath: '/b', status: CommandStatus.IN_PROCESS, retryCount: 1, commandId: 'c2' }], jobRunId: 'job2' };
      const jobContext: any = {
        jobRunId: 'job2',
        jobConfig: { sourceFileServer: { pathId: 'p1' }, options: {} }, dirsInfo: { lastId: '', numMessages: 0 },
        appendToDirList: jest.fn(),
        appendToFileList: jest.fn(),
        appendToErrorList: jest.fn(),
        errorsInfo: { lastId: '' },
        appendToTaskList: jest.fn(),
        appendToUpdatedTaskList: jest.fn(),
        getScanTask: jest.fn(),
        setScanTask: jest.fn(),
        deleteScanTask: jest.fn()
      };
      // First scanDirCommand returns error
      jest.spyOn(service, 'scanDirCommand').mockResolvedValue({ files: 0, directory: 0, error: 'ERR' } as any);

      const result = await service.discover({ task, jobContext } as any);
      expect(result.error).toBe(1);
      expect(task.status).toBe(TaskStatus.ERRORED);
      expect(jobContext.appendToErrorList).toHaveBeenCalled();
    });

    it('Should handle scanPath.retryCount > 0 and retry', async () => {
      const task: any = { id: 't3', commands: [{ fPath: '/c', status: CommandStatus.IN_PROCESS, retryCount: 1, commandId: 'c3' }], jobRunId: 'job3' };
      const jobContext: any = {
        jobRunId: 'job3',
        jobConfig: { sourceFileServer: { pathId: 'p1' }, options: {} }, dirsInfo: { lastId: '', numMessages: 0 },
        taskInfo: { lastId: '' },
        updatedTaskInfo: { lastId: '' },
        appendToDirList: jest.fn(),
        appendToFileList: jest.fn(),
        appendToErrorList: jest.fn(),
        errorsInfo: { lastId: '' },
        appendToTaskList: jest.fn(),
        appendToUpdatedTaskList: jest.fn(),
        getScanTask: jest.fn(),
        setScanTask: jest.fn(),
        deleteScanTask: jest.fn()
      };
      // Mock scanDirCommand to throw an error
      jest.spyOn(service, 'scanDirCommand').mockRejectedValue({ retryCount: 4, error: 'Scan failed' });
      const result = await service.discover({ task, jobContext } as any);
      expect(result).toBeDefined();
    });

    it('Should handle isFatalError', async () => {
      const task: any = { id: 't4', commands: [{ fPath: '/d', status: CommandStatus.IN_PROCESS, retryCount: 0, commandId: 'c4' }], jobRunId: 'job4' };
      const jobContext: any = {
        jobRunId: 'job4',
        jobConfig: { sourceFileServer: { pathId: 'p1' }, options: {} }, dirsInfo: { lastId: '', numMessages: 0 },
        taskInfo: { lastId: '' },
        updatedTaskInfo: { lastId: '' },
        appendToDirList: jest.fn(),
        appendToFileList: jest.fn(),
        appendToErrorList: jest.fn(),
        errorsInfo: { lastId: '' },
        appendToTaskList: jest.fn(),
        appendToUpdatedTaskList: jest.fn(),
        getScanTask: jest.fn(),
        setScanTask: jest.fn(),
        deleteScanTask: jest.fn()
      };
      // Mock scanDirCommand to throw a fatal error
      jest.spyOn(service, 'scanDirCommand').mockResolvedValue({ files: 0, directory: 0, error: 'Some fatal error.' } as any);
      jest.spyOn(utils, 'isFatalError').mockReturnValue(true);
      const result = await service.discover({ task, jobContext } as any);
      expect(result.isFatal).toBe(true);
    });
  });

  // describe('getDirectoryContents', () => {
  //   it('should return directory contents', async () => {
  //     const mockDir = { name: 'dir1', fullFilePath: '/base/dir1', relativePath: 'dir1' };
  //     const mockFiles = [{ name: 'file1.txt', fullFilePath: '/base/dir1/file1.txt', relativePath: 'dir1/file1.txt' }];
  //     jest.spyOn(service, 'getDirectoryContents').mockResolvedValue({ directories: [mockDir], files: mockFiles } as any);

  //     const result = await service.getDirectoryContents('/base/dir1');
  //     expect(result).toEqual({ directories: [mockDir], files: mockFiles });
  //   });

  //   it('should handle errors in getDirectoryContents', async () => {
  //     jest.spyOn(service, 'getDirectoryContents').mockRejectedValue(new Error('Failed to read directory'));

  //     await expect(service.getDirectoryContents('/base/dir1')).rejects.toThrow('Failed to read directory');
  //   });

  //   it('should handle empty directory', async () => {
  //     jest.spyOn(service, 'getDirectoryContents').mockResolvedValue({ directories: [], files: [] } as any);

  //     const result = await service.getDirectoryContents('/base/emptyDir');
  //     expect(result).toEqual({ directories: [], files: [] });
  //   });

  //   it('should handle non-existent directory', async () => {
  //     jest.spyOn(service, 'getDirectoryContents').mockResolvedValue({ directories: [], files: [] } as any);

  //     const result = await service.getDirectoryContents('/base/nonExistentDir', );
  //     expect(result).toEqual({ directories: [], files: [] });
  //   });
  // })

  describe('scanDirCommand', () => {
    it('should return files and directories', async () => {
      const mockDir = [{
        name: 'docs',
        isFile: () => false,
        isDirectory: () => true,
        isSymbolicLink: () => false,
      }];
      const mockFiles: Dirent[] = [
        {
          name: 'index.js',
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => false,
          parentPath: '',
          path: ''
        } as Dirent,
        {
          name: 'README.md',
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => false,
          parentPath: '',
          path: ''
        } as Dirent
      ];
      const jobContext: any = {
        jobRunId: 'job4',
        jobConfig: { sourceFileServer: { pathId: 'p1' }, options: {} }, dirsInfo: { lastId: '', numMessages: 0 },
        taskInfo: { lastId: '' },
        updatedTaskInfo: { lastId: '' },
        appendToDirList: jest.fn(),
        appendToFileList: jest.fn(),
        appendToErrorList: jest.fn(),
        errorsInfo: { lastId: '' },
        appendToTaskList: jest.fn(),
        appendToUpdatedTaskList: jest.fn(),
        getScanTask: jest.fn(),
        setScanTask: jest.fn(),
        deleteScanTask: jest.fn()
      };
      jest.spyOn(service, 'getDirectoryContents').mockResolvedValue([...mockFiles, ...mockDir] as Dirent[]);
      const mockPayload = {
        sourcePath: '/base',
        sourcePrefix: '/base/',
        excludePatterns: [],
        command: {
          status: CommandStatus.IN_PROCESS,
          retryCount: 0,
          commandId: 'c1',
          fPath: '/base',
          ops: [],
          serialize: () => ''
        } as any,
        jobContext: jobContext,
        skipFile: '',
        errorType: null as any
      };
      const result = await service.scanDirCommand(mockPayload as ScanDirCommandInput);
      expect(result).toBeDefined();
    });

    it('Should handle symbolic links', async () => {
      const mockDir = [{
        name: 'symlink',
        isFile: () => false,
        isDirectory: () => false,
        isSymbolicLink: () => true,
      }];
      const jobContext: any = {
        jobRunId: 'job4',
        jobConfig: { sourceFileServer: { pathId: 'p1' }, options: {} }, dirsInfo: { lastId: '', numMessages: 0 },
        taskInfo: { lastId: '' },
        updatedTaskInfo: { lastId: '' },
        appendToDirList: jest.fn(),
        appendToFileList: jest.fn(),
        appendToErrorList: jest.fn(),
        errorsInfo: { lastId: '' },
        appendToTaskList: jest.fn(),
        appendToUpdatedTaskList: jest.fn(),
        getScanTask: jest.fn(),
        setScanTask: jest.fn(),
        deleteScanTask: jest.fn()
      };
      jest.spyOn(service, 'getDirectoryContents').mockResolvedValue(mockDir as Dirent[]);
      const mockPayload = {
        sourcePath: '/base/symlink',
        sourcePrefix: '/base/symlink/',
        excludePatterns: [],
        command: {
          status: CommandStatus.IN_PROCESS,
          retryCount: 0,
          commandId: 'c1',
          fPath: '/base/symlink',
          ops: [],
          serialize: () => ''
        } as any,
        jobContext,
        skipFile: '',
        errorType: null as any
      };

      jest.spyOn(fs.promises, 'lstat').mockResolvedValue({
        isSymbolicLink: () => true,
        isDirectory: () => false,
        isFile: () => true,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isFIFO: () => false,
        isSocket: () => false,
      } as any);

      const result = await service.scanDirCommand(mockPayload as ScanDirCommandInput);
      expect(result).toBeDefined();
    });

    it('Should log if symbolic link is broken', async () => {
      const mockDir = [{
        name: 'symlink',
        isFile: () => false,
        isDirectory: () => false,
        isSymbolicLink: () => true,
      }];
      const jobContext: any = {
        jobRunId: 'job4',
        jobConfig: { sourceFileServer: { pathId: 'p1' }, options: {} }, dirsInfo: { lastId: '', numMessages: 0 },
        taskInfo: { lastId: '' },
        updatedTaskInfo: { lastId: '' },
        appendToDirList: jest.fn(),
        appendToFileList: jest.fn(),
        appendToErrorList: jest.fn(),
        errorsInfo: { lastId: '' },
        appendToTaskList: jest.fn(),
        appendToUpdatedTaskList: jest.fn(),
        getScanTask: jest.fn(),
        setScanTask: jest.fn(),
        deleteScanTask: jest.fn()
      };
      jest.spyOn(service, 'getDirectoryContents').mockResolvedValue(mockDir as Dirent[]);
      const mockPayload = {
        sourcePath: '/base/symlink',
        sourcePrefix: '/base/symlink/',
        excludePatterns: [],
        command: {
          status: CommandStatus.IN_PROCESS,
          retryCount: 0,
          commandId: 'c1',
          fPath: '/base/symlink',
          ops: [],
          serialize: () => ''
        } as any,
        jobContext,
        skipFile: '',
        errorType: null as any
      };

      jest.spyOn(fs.promises, 'lstat').mockResolvedValue({
        isSymbolicLink: () => true,
        isDirectory: () => false,
        isFile: () => true,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isFIFO: () => false,
        isSocket: () => false,
      } as any);
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);

      const result = await service.scanDirCommand(mockPayload as ScanDirCommandInput);
      expect(result).toBeDefined();
    });

    it('Should handle shouldExcludeOrSkip true', async () => {
      const mockDir = [{
        name: 'docs',
        isFile: () => false,
        isDirectory: () => true,
        isSymbolicLink: () => false,
      }];
      const jobContext: any = {
        jobRunId: 'job4',
        jobConfig: { sourceFileServer: { pathId: 'p1' }, options: {} }, dirsInfo: { lastId: '', numMessages: 0 },
        taskInfo: { lastId: '' },
        updatedTaskInfo: { lastId: '' },
        appendToDirList: jest.fn(),
        appendToFileList: jest.fn(),
        appendToErrorList: jest.fn(),
        errorsInfo: { lastId: '' },
        appendToTaskList: jest.fn(),
        appendToUpdatedTaskList: jest.fn(),
        getScanTask: jest.fn(),
        setScanTask: jest.fn(),
        deleteScanTask: jest.fn()
      };
      jest.spyOn(service, 'getDirectoryContents').mockResolvedValue(mockDir as Dirent[]);
      const mockPayload = {
        sourcePath: '/base/docs',
        sourcePrefix: '/base/docs/',
        excludePatterns: [],
        command: {
          status: CommandStatus.IN_PROCESS,
          retryCount: 0,
          commandId: 'c1',
          fPath: '/base/docs',
          ops: [],
          serialize: () => ''
        } as any,
        jobContext,
        skipFile: '',
        errorType: null as any
      };
      jest.spyOn(utils, 'shouldExcludeOrSkip').mockReturnValue(true);
      const result = await service.scanDirCommand(mockPayload as ScanDirCommandInput);
      expect(result).toBeDefined();
    });
  })

  it('Should skip directories that are symlinks', async () => {
    const mockDir = [{
      name: 'dir-symlink',
      isFile: () => false,
      isDirectory: () => true,
      isSymbolicLink: () => true,
    }];
    jest.spyOn(service, 'getDirectoryContents').mockResolvedValue(mockDir as Dirent[]);
    jest.spyOn(fs.promises, 'lstat').mockResolvedValue({
      isSymbolicLink: () => true,
      isDirectory: () => true,
      isFile: () => false,
    } as any);
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    const basicPayload = {
      excludePatterns: [],
      command: {
        status: CommandStatus.IN_PROCESS,
        retryCount: 0,
        commandId: 'c1',
        fPath: '/base/docs',
        ops: [],
        serialize: () => ''
      } as any,
      jobContext: {
        appendToErrorList: jest.fn(),
        errorsInfo: { lastId: '' },
      },
      skipFile: '',
      errorType: null as any
    }
    const result = await service.scanDirCommand({ ...basicPayload, sourcePath: '/base', sourcePrefix: '/base/' } as any);
    expect(result.directory).toBe(0);
  });
});
