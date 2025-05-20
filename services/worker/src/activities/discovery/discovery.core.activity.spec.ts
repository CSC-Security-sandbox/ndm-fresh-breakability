
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandStatus, TaskStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import { RedisService } from 'src/redis/redis.service';
import { CommonActivityService } from '../common/common.service';
import * as utils from '../utils/utils';
import { DiscoveryScanActivity } from './discovery.core.activity';


jest.mock('@temporalio/activity', () => ({
  Context: {
      current: jest.fn().mockResolvedValue(()=>({
          heartbeat: jest.fn(),
      }))
  },
}))

const mockLogger = { log: jest.fn(), debug: jest.fn(), error: jest.fn() } as any as Logger;
const mockRedis = { getJobContext: jest.fn(), setJobContext: jest.fn() } as any as RedisService;
const mockCommon = { fetchOneTask: jest.fn(), addFailedWorkerToJobState: jest.fn() } as any as CommonActivityService;
const mockConfig = { get: jest.fn() } as any as ConfigService;

jest.mock('@temporalio/activity', () => ({
  Context: {
    current: jest.fn(),
  },
}));

describe('DiscoveryScanActivity', () => {
  let service: DiscoveryScanActivity;
  let basePrefixSpy: jest.SpyInstance;

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

    service = new DiscoveryScanActivity(mockLogger, mockRedis, mockConfig, mockCommon);
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

      const result = await service.scanActivity({ jobRunId: 'job1' , failedWorkers: []});
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

      const result = await service.scanActivity({ jobRunId: 'job1', failedWorkers: []});
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
  });

  describe('discover', () => {
    it('should mark task completed when no errors', async () => {
      const task: any = { id: 't1', commands: [{ fPath: '/a', status: CommandStatus.IN_PROCESS, retryCount: 0, commandId: 'c1' }], jobRunId: 'job1' };
      const jobContext: any = { 
        jobRunId: 'job1',
        jobConfig: { sourceFileServer: { pathId: 'p1' }, options: {} },updatedTaskInfo: {lastId:'1'}, dirsInfo: { lastId: '', numMessages: 0 },
        appendToDirList: jest.fn(),
        appendToFileList: jest.fn(),
        appendToErrorList: jest.fn(),
        errorsInfo: { lastId: '' } ,
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
  });
});
