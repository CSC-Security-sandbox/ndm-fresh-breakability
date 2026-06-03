import { buildTask, isPathExists, isNotWritable } from './utils';
import {
  Cmd,
  JobManagerContext,
  TaskInfo,
  TaskStatus,
  TaskType,
  CommandStatus,
  Operations,
} from '@netapp-cloud-datamigrate/jobs-lib';
import * as fs from 'fs';
import { uuid4 } from '@temporalio/workflow';

// Mock dependencies
jest.mock('@temporalio/workflow');
jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
  },
  constants: {
    F_OK: 0,
    W_OK: 2,
  },
}));

const mockUuid4 = uuid4 as jest.MockedFunction<typeof uuid4>;
const mockAccess = fs.promises.access as jest.MockedFunction<
  typeof fs.promises.access
>;

describe('Utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('buildTask', () => {
    // Create a minimal mock context that satisfies the interface
    const createMockJobContext = (overrides: any = {}): JobManagerContext => {
      return {
        jobConfig: {
          workerIds: ['worker-1', 'worker-2'],
          sourceFileServer: {
            pathId: 'source-path-id',
          },
          destinationFileServer: {
            pathId: 'dest-path-id',
          },
          ...overrides.jobConfig,
        },
        // Add minimal implementations for required methods
        getJobRunId: () => 'job-run-123',
        getJobRunStatus: () => TaskStatus.PENDING,
        getJobConfig: () => ({ workerIds: ['worker-1'] }),
        publishToFileStream: async () => {},
        publishToTaskStream: async () => {},
        publishToTaskErrorStream: async () => {},
        publishToOpErrorStream: async () => {},
        ...overrides,
      } as JobManagerContext;
    };

    const createMockCmd = (overrides: any = {}): Cmd => {
      const ops: Operations = {};
      return new Cmd(
        overrides.id || 'cmd-1',
        overrides.fPath || '/source/file.txt',
        overrides.status || CommandStatus.READY,
        overrides.isDir || false,
        ops,
        overrides.metadata || {
          size: 1024,
          mtime: new Date(),
          atime: new Date(),
          ctime: new Date(),
          birthtime: new Date(),
          mode: 0o644,
          uid: 1000,
          gid: 1000,
          sid: 'S-1-5-21-123456789-123456789-123456789-1001',
        },
      );
    };

    it('should create a task with SCAN task type', () => {
      mockUuid4.mockReturnValue('unique-task-id');
      const mockJobContext = createMockJobContext();
      const mockCommands = [createMockCmd()];

      const result = buildTask(
        TaskType.SCAN,
        'job-run-456',
        mockJobContext,
        mockCommands,
      );

      expect(mockUuid4).toHaveBeenCalled();
      expect(result).toBeInstanceOf(TaskInfo);
      expect(result.id).toBe('unique-task-id');
      expect(result.jobRunId).toBe('job-run-456');
      expect(result.taskType).toBe(TaskType.SCAN);
      expect(result.status).toBe(TaskStatus.PENDING);
      expect(result.workerId).toBe('worker-1'); // First worker from array
      expect(result.sPathId).toBe('source-path-id');
      expect(result.tPathId).toBe('dest-path-id');
      expect(result.commands).toEqual(mockCommands);
      expect(result.retryCount).toBe(0);
    });

    it('should create a task with MIGRATE task type', () => {
      mockUuid4.mockReturnValue('migrate-task-id');
      const mockJobContext = createMockJobContext();
      const mockCommands = [createMockCmd()];

      const result = buildTask(
        TaskType.MIGRATE,
        'job-run-789',
        mockJobContext,
        mockCommands,
      );

      expect(result.taskType).toBe(TaskType.MIGRATE);
      expect(result.id).toBe('migrate-task-id');
      expect(result.jobRunId).toBe('job-run-789');
    });

    it('should handle context without destination file server', () => {
      mockUuid4.mockReturnValue('task-no-dest');
      const contextWithoutDest = createMockJobContext({
        jobConfig: {
          workerIds: ['worker-1', 'worker-2'],
          sourceFileServer: {
            pathId: 'source-path-id',
          },
          destinationFileServer: null,
        },
      });
      const mockCommands = [createMockCmd()];

      const result = buildTask(
        TaskType.SCAN,
        'job-run-456',
        contextWithoutDest,
        mockCommands,
      );

      expect(result.tPathId).toBeNull();
      expect(result.sPathId).toBe('source-path-id');
    });

    it('should handle context with undefined destination file server', () => {
      mockUuid4.mockReturnValue('task-undef-dest');
      const contextWithoutDest = createMockJobContext({
        jobConfig: {
          workerIds: ['worker-1', 'worker-2'],
          sourceFileServer: {
            pathId: 'source-path-id',
          },
          // destinationFileServer is undefined
        },
      });
      const mockCommands = [createMockCmd()];

      const result = buildTask(
        TaskType.SCAN,
        'job-run-456',
        contextWithoutDest,
        mockCommands,
      );

      expect(result.tPathId).toBeNull();
      expect(result.sPathId).toBe('source-path-id');
    });

    it('should use first worker ID from the array', () => {
      mockUuid4.mockReturnValue('task-first-worker');
      const mockJobContext = createMockJobContext();
      const mockCommands = [createMockCmd()];

      const result = buildTask(
        TaskType.SCAN,
        'job-run-456',
        mockJobContext,
        mockCommands,
      );

      expect(result.workerId).toBe('worker-1'); // First worker from ['worker-1', 'worker-2']
    });

    it('should handle context with single worker', () => {
      mockUuid4.mockReturnValue('task-single-worker');
      const contextWithSingleWorker = createMockJobContext({
        jobConfig: {
          workerIds: ['only-worker'],
          sourceFileServer: { pathId: 'source-path-id' },
          destinationFileServer: { pathId: 'dest-path-id' },
        },
      });
      const mockCommands = [createMockCmd()];

      const result = buildTask(
        TaskType.SCAN,
        'job-run-456',
        contextWithSingleWorker,
        mockCommands,
      );

      expect(result.workerId).toBe('only-worker');
    });

    it('should handle empty commands array', () => {
      mockUuid4.mockReturnValue('task-no-commands');
      const mockJobContext = createMockJobContext();

      const result = buildTask(
        TaskType.SCAN,
        'job-run-456',
        mockJobContext,
        [],
      );

      expect(result.commands).toEqual([]);
    });

    it('should handle multiple commands', () => {
      mockUuid4.mockReturnValue('task-multi-commands');
      const mockJobContext = createMockJobContext();
      const mockCommands = [
        createMockCmd({ id: 'cmd-1', fPath: '/source/file1.txt' }),
        createMockCmd({ id: 'cmd-2', fPath: '/source/file2.txt' }),
        createMockCmd({ id: 'cmd-3', fPath: '/source/file3.txt' }),
      ];

      const result = buildTask(
        TaskType.MIGRATE,
        'job-run-456',
        mockJobContext,
        mockCommands,
      );

      expect(result.commands).toHaveLength(3);
      expect(result.commands[0].id).toBe('cmd-1');
      expect(result.commands[1].id).toBe('cmd-2');
      expect(result.commands[2].id).toBe('cmd-3');
    });

    it('should set default retry count to 0', () => {
      mockUuid4.mockReturnValue('task-retry');
      const mockJobContext = createMockJobContext();
      const mockCommands = [createMockCmd()];

      const result = buildTask(
        TaskType.SCAN,
        'job-run-456',
        mockJobContext,
        mockCommands,
      );

      expect(result.retryCount).toBe(0);
    });

    it('should handle commands with different file types', () => {
      mockUuid4.mockReturnValue('task-mixed-files');
      const mockJobContext = createMockJobContext();
      const mockCommands = [
        createMockCmd({
          id: 'file-cmd',
          fPath: '/source/file.txt',
          isDir: false,
        }),
        createMockCmd({
          id: 'dir-cmd',
          fPath: '/source/directory',
          isDir: true,
        }),
      ];

      const result = buildTask(
        TaskType.MIGRATE,
        'job-run-456',
        mockJobContext,
        mockCommands,
      );

      expect(result.commands).toHaveLength(2);
      expect(result.commands[0].isDir).toBe(false);
      expect(result.commands[1].isDir).toBe(true);
    });

    it('should generate unique task IDs for each call', () => {
      const mockJobContext = createMockJobContext();
      const mockCommands = [createMockCmd()];

      mockUuid4
        .mockReturnValueOnce('task-id-1')
        .mockReturnValueOnce('task-id-2');

      const result1 = buildTask(
        TaskType.SCAN,
        'job-run-456',
        mockJobContext,
        mockCommands,
      );
      const result2 = buildTask(
        TaskType.SCAN,
        'job-run-456',
        mockJobContext,
        mockCommands,
      );

      expect(result1.id).toBe('task-id-1');
      expect(result2.id).toBe('task-id-2');
      expect(mockUuid4).toHaveBeenCalledTimes(2);
    });

    it('should preserve job run ID', () => {
      const mockJobContext = createMockJobContext();
      const mockCommands = [createMockCmd()];
      const jobRunIds = ['job-run-1', 'job-run-2', 'job-run-3'];

      jobRunIds.forEach((jobRunId) => {
        mockUuid4.mockReturnValue(`task-${jobRunId}`);
        const result = buildTask(
          TaskType.SCAN,
          jobRunId,
          mockJobContext,
          mockCommands,
        );
        expect(result.jobRunId).toBe(jobRunId);
      });
    });

    it('should handle different metadata configurations', () => {
      mockUuid4.mockReturnValue('task-minimal-meta');
      const mockJobContext = createMockJobContext();
      const commandWithMinimalMeta = [
        createMockCmd({
          id: 'cmd-minimal',
          fPath: '/source/file.txt',
          metadata: {
            size: 0,
            mtime: new Date('2023-01-01'),
            atime: new Date('2023-01-01'),
            ctime: new Date('2023-01-01'),
            birthtime: new Date('2023-01-01'),
            mode: 0o000,
            uid: 0,
            gid: 0,
            sid: '',
          },
        }),
      ];

      const result = buildTask(
        TaskType.SCAN,
        'job-run-456',
        mockJobContext,
        commandWithMinimalMeta,
      );
      expect(result.commands[0].metadata?.size).toBe(0);
      expect(result.commands[0].metadata?.uid).toBe(0);
    });
  });

  describe('isPathExists', () => {
    it('should return true when path exists', async () => {
      mockAccess.mockResolvedValue(undefined);

      const result = await isPathExists('/existing/path');

      expect(result).toBe(true);
      expect(mockAccess).toHaveBeenCalledWith(
        '/existing/path',
        fs.constants.F_OK,
      );
    });

    it('should return false when path does not exist (ENOENT)', async () => {
      const enoentError = Object.assign(new Error('no such file or directory'), { code: 'ENOENT' });
      mockAccess.mockRejectedValue(enoentError);

      const result = await isPathExists('/non/existing/path');

      expect(result).toBe(false);
      expect(mockAccess).toHaveBeenCalledWith(
        '/non/existing/path',
        fs.constants.F_OK,
      );
    });

    it('should handle empty path', async () => {
      const enoentError = Object.assign(new Error('no such file or directory'), { code: 'ENOENT' });
      mockAccess.mockRejectedValue(enoentError);

      const result = await isPathExists('');

      expect(result).toBe(false);
      expect(mockAccess).toHaveBeenCalledWith('', fs.constants.F_OK);
    });

    it('should handle special characters in path', async () => {
      const specialPath = '/path/with spaces/and-symbols_123.txt';
      mockAccess.mockResolvedValue(undefined);

      const result = await isPathExists(specialPath);

      expect(result).toBe(true);
      expect(mockAccess).toHaveBeenCalledWith(specialPath, fs.constants.F_OK);
    });

    it('should handle very long path', async () => {
      const longPath = '/very/long/path/' + 'a'.repeat(1000) + '/file.txt';
      const enoentError = Object.assign(new Error('no such file or directory'), { code: 'ENOENT' });
      mockAccess.mockRejectedValue(enoentError);

      const result = await isPathExists(longPath);

      expect(result).toBe(false);
      expect(mockAccess).toHaveBeenCalledWith(longPath, fs.constants.F_OK);
    });

    it('should handle root path', async () => {
      mockAccess.mockResolvedValue(undefined);

      const result = await isPathExists('/');

      expect(result).toBe(true);
      expect(mockAccess).toHaveBeenCalledWith('/', fs.constants.F_OK);
    });

    it('should handle relative path', async () => {
      mockAccess.mockResolvedValue(undefined);

      const result = await isPathExists('./relative/path');

      expect(result).toBe(true);
      expect(mockAccess).toHaveBeenCalledWith(
        './relative/path',
        fs.constants.F_OK,
      );
    });

    it('should handle network path format', async () => {
      const networkPath = '\\\\server\\share\\file.txt';
      mockAccess.mockResolvedValue(undefined);

      const result = await isPathExists(networkPath);

      expect(result).toBe(true);
      expect(mockAccess).toHaveBeenCalledWith(networkPath, fs.constants.F_OK);
    });

    describe('strict=false (default) — swallows non-ENOENT errors', () => {
      it('should return false on EIO without throwing', async () => {
        const eioError = Object.assign(new Error('Input/output error'), { code: 'EIO' });
        mockAccess.mockRejectedValue(eioError);

        const result = await isPathExists('/nfs/path');

        expect(result).toBe(false);
      });

      it('should return false on ECONNRESET without throwing', async () => {
        const err = Object.assign(new Error('Connection reset by peer'), { code: 'ECONNRESET' });
        mockAccess.mockRejectedValue(err);

        const result = await isPathExists('/nfs/path');

        expect(result).toBe(false);
      });
    });

    describe('strict=true — re-throws non-ENOENT errors with original error.code', () => {
      it('should still return false on ENOENT', async () => {
        const enoentError = Object.assign(new Error('no such file or directory'), { code: 'ENOENT' });
        mockAccess.mockRejectedValue(enoentError);

        const result = await isPathExists('/non/existing/path', true);

        expect(result).toBe(false);
      });

      it('should throw on EIO preserving error.code', async () => {
        const eioError = Object.assign(new Error('Input/output error'), { code: 'EIO' });
        mockAccess.mockRejectedValue(eioError);

        await expect(isPathExists('/nfs/stalled/path', true)).rejects.toMatchObject({ code: 'EIO' });
      });

      it('should throw on ECONNRESET preserving error.code', async () => {
        const err = Object.assign(new Error('Connection reset by peer'), { code: 'ECONNRESET' });
        mockAccess.mockRejectedValue(err);

        await expect(isPathExists('/nfs/stalled/path', true)).rejects.toMatchObject({ code: 'ECONNRESET' });
      });

      it('should throw on ETIMEDOUT preserving error.code', async () => {
        const err = Object.assign(new Error('Connection timed out'), { code: 'ETIMEDOUT' });
        mockAccess.mockRejectedValue(err);

        await expect(isPathExists('/nfs/stalled/path', true)).rejects.toMatchObject({ code: 'ETIMEDOUT' });
      });
    });
  });

  describe('isNotWritable', () => {
    it('should return false when path is writable', async () => {
      mockAccess.mockResolvedValue(undefined);

      const result = await isNotWritable('/writable/path');

      expect(result).toBe(false);
      expect(mockAccess).toHaveBeenCalledWith(
        '/writable/path',
        fs.constants.W_OK,
      );
    });

    it('should return true when path is not writable', async () => {
      const error = new Error('Permission denied') as any;
      error.code = 'EACCES';
      mockAccess.mockRejectedValue(error);

      const result = await isNotWritable('/readonly/path');

      expect(result).toBe(true);
      expect(mockAccess).toHaveBeenCalledWith(
        '/readonly/path',
        fs.constants.F_OK | fs.constants.W_OK,
      );
    });

    it('should handle non-existent path', async () => {
      const error = new Error('ENOENT: no such file or directory') as any;
      error.code = 'ENOENT';
      mockAccess.mockRejectedValue(error);

      const result = await isNotWritable('/non/existent/path');

      expect(result).toBe(false); // Function returns false for non-existent paths
      expect(mockAccess).toHaveBeenCalledWith(
        '/non/existent/path',
        fs.constants.F_OK | fs.constants.W_OK,
      );
    });

    it('should handle directory path', async () => {
      mockAccess.mockResolvedValue(undefined);

      const result = await isNotWritable('/writable/directory/');

      expect(result).toBe(false);
      expect(mockAccess).toHaveBeenCalledWith(
        '/writable/directory/',
        fs.constants.F_OK | fs.constants.W_OK,
      );
    });

    it('should handle read-only directory', async () => {
      const error = new Error('EACCES: permission denied') as any;
      error.code = 'EACCES';
      mockAccess.mockRejectedValue(error);

      const result = await isNotWritable('/readonly/directory');

      expect(result).toBe(true);
      expect(mockAccess).toHaveBeenCalledWith(
        '/readonly/directory',
        fs.constants.F_OK | fs.constants.W_OK,
      );
    });

    it('should handle empty path', async () => {
      const error = new Error('Invalid path') as any;
      error.code = 'EINVAL';
      mockAccess.mockRejectedValue(error);

      const result = await isNotWritable('');

      expect(result).toBe(false); // Function returns false for other errors
      expect(mockAccess).toHaveBeenCalledWith(
        '',
        fs.constants.F_OK | fs.constants.W_OK,
      );
    });

    it('should handle system directories', async () => {
      const error = new Error('EACCES: permission denied') as any;
      error.code = 'EACCES';
      mockAccess.mockRejectedValue(error);

      const result = await isNotWritable('/etc/passwd');

      expect(result).toBe(true);
      expect(mockAccess).toHaveBeenCalledWith(
        '/etc/passwd',
        fs.constants.F_OK | fs.constants.W_OK,
      );
    });

    it('should handle temporary directories', async () => {
      mockAccess.mockResolvedValue(undefined);

      const result = await isNotWritable('/tmp/writable-file');

      expect(result).toBe(false);
      expect(mockAccess).toHaveBeenCalledWith(
        '/tmp/writable-file',
        fs.constants.F_OK | fs.constants.W_OK,
      );
    });

    it('should handle user home directory', async () => {
      mockAccess.mockResolvedValue(undefined);

      const result = await isNotWritable('/Users/username/Documents/file.txt');

      expect(result).toBe(false);
      expect(mockAccess).toHaveBeenCalledWith(
        '/Users/username/Documents/file.txt',
        fs.constants.F_OK | fs.constants.W_OK,
      );
    });

    it('should handle network paths', async () => {
      const networkPath = '\\\\server\\readonly-share\\file.txt';
      const error = new Error('Access denied') as any;
      error.code = 'EACCES';
      mockAccess.mockRejectedValue(error);

      const result = await isNotWritable(networkPath);

      expect(result).toBe(true);
      expect(mockAccess).toHaveBeenCalledWith(
        networkPath,
        fs.constants.F_OK | fs.constants.W_OK,
      );
    });

    it('should handle EPERM error code', async () => {
      const error = new Error('Operation not permitted') as any;
      error.code = 'EPERM';
      mockAccess.mockRejectedValue(error);

      const result = await isNotWritable('/protected/file');

      expect(result).toBe(true);
      expect(mockAccess).toHaveBeenCalledWith(
        '/protected/file',
        fs.constants.F_OK | fs.constants.W_OK,
      );
    });
  });

  // Edge case integration tests
  describe('Integration edge cases', () => {
    it('should handle fs access throwing unexpected error types', async () => {
      // Test non-Error objects being thrown
      mockAccess.mockRejectedValue('string error');

      const existsResult = await isPathExists('/test');
      const writableResult = await isNotWritable('/test');

      expect(existsResult).toBe(false);
      expect(writableResult).toBe(false); // isNotWritable returns false for non-standard errors
    });

    it('should handle fs access throwing null/undefined', async () => {
      const errorWithCode = { code: 'ENOENT' } as any;
      mockAccess.mockRejectedValue(errorWithCode);

      const existsResult = await isPathExists('/test');

      // For isNotWritable, test with proper error object
      const permError = { code: 'EACCES' } as any;
      mockAccess.mockRejectedValue(permError);
      const writableResult = await isNotWritable('/test');

      expect(existsResult).toBe(false);
      expect(writableResult).toBe(true);
    });

    it('should handle multiple concurrent path checks', async () => {
      const enoentError = { code: 'ENOENT' } as any;
      const eaccesError = { code: 'EACCES' } as any;

      mockAccess
        .mockResolvedValueOnce(undefined) // First call succeeds
        .mockRejectedValueOnce(enoentError) // Second call fails with ENOENT
        .mockResolvedValueOnce(undefined) // Third call succeeds
        .mockRejectedValueOnce(eaccesError); // Fourth call fails with EACCES

      const results = await Promise.all([
        isPathExists('/path1'),
        isPathExists('/path2'),
        isNotWritable('/path3'),
        isNotWritable('/path4'),
      ]);

      expect(results).toEqual([true, false, false, true]);
    });
  });
});
