import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TaskStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import { ProcessRetryBatchActivity } from '../activities/core/retry/process-retry-batch.activity';
import { CommandGenerationService } from '../activities/core/shared/command-generation.service';
import { DirStreamingService } from '../activities/core/shared/dir-streaming.service';
import { DeferredDirStampService } from '../activities/core/shared/deferred-dir-stamp.service';
import { RedisService } from '../redis/redis.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { WorkersConfig } from '../config/app.config';
import { FatalError, RetryableError } from '../errors/errors.types';
import { RetryScanSettings } from '../workflows/core/child/child-retry-scan.workflow.type';

jest.mock('@temporalio/activity', () => ({
  Context: {
    current: jest.fn().mockReturnValue({ heartbeat: jest.fn() }),
  },
}));
jest.mock('@temporalio/workflow', () => ({ uuid4: jest.fn().mockReturnValue('uuid-mock') }));

/**
 * Real classes wired:
 *   ProcessRetryBatchActivity — routing switch (type='ops' vs 'dir')
 *                             → processOperationsBatch / processDirectoryBatch (real)
 *
 * Mocked boundaries:
 *   RedisService.getJobManagerContext  — returns mock jobContext
 *   CommandGenerationService.processItems — file list processing
 *   DirStreamingService.streamDirToRedisSet / streamDirEntries — dir streaming
 *   DeferredDirStampService.updateSourceCtime — deferred stamps
 */

const mockLogger = {
  log: jest.fn(), error: jest.fn(), warn: jest.fn(),
  debug: jest.fn(), verbose: jest.fn(), setContext: jest.fn(),
};
const mockLoggerFactory: LoggerFactory = {
  create: jest.fn().mockReturnValue(mockLogger),
} as any;

const mockConfigService = {
  get: jest.fn((key: string) => {
    const map: Record<string, any> = {
      'worker.maxMigrationCommand': 100,
    };
    return map[key];
  }),
};

const mockRedisService           = { getJobManagerContext: jest.fn() };
const mockCommandGenerationService = { processItems: jest.fn() };
const mockDirStreamingService    = {
  getDirContentKey:     jest.fn().mockReturnValue('dir-content-key'),
  streamDirToRedisSet:  jest.fn(),
  streamDirEntries:     jest.fn(),
};
const mockDeferredDirStampService = { updateSourceCtime: jest.fn() };

function makeJobContext(batchData?: any, dirCommands?: any) {
  return {
    jobConfig: {
      workerIds: ['worker-1'],
      sourceFileServer: { pathId: 'src-path', hostname: '10.0.0.1' },
      destinationFileServer: { pathId: 'dst-path', hostname: '10.0.0.2' },
    },
    jobRunId: 'job-ret01',
    getRetryBatch: jest.fn().mockResolvedValue(batchData ?? null),
    getBatchDir: jest.fn().mockResolvedValue(dirCommands ?? null),
    getTask: jest.fn().mockResolvedValue(null),
    setTask: jest.fn().mockResolvedValue(undefined),
    setTaskIfNotExists: jest.fn().mockResolvedValue(undefined),
    deleteTask: jest.fn().mockResolvedValue(undefined),
    deleteBatchDir: jest.fn().mockResolvedValue(undefined),
    deleteRetryBatch: jest.fn().mockResolvedValue(undefined),
    deleteDirContentSet: jest.fn().mockResolvedValue(undefined),
    publishToTaskStream: jest.fn().mockResolvedValue(undefined),
    publishBulkToCommandStream: jest.fn().mockResolvedValue(undefined),
    setBatchDir: jest.fn().mockResolvedValue(undefined),
  };
}

const defaultSettings: RetryScanSettings = {
  sourcePrefix: '/mnt/src',
  targetPrefix: '/mnt/dst',
  skipFile: '',
  excludePatterns: [],
  isSMB: false,
};

describe('Component: processRetryBatch (ProcessRetryBatchActivity)', () => {
  let activity: ProcessRetryBatchActivity;

  beforeEach(async () => {
    jest.clearAllMocks();
    new WorkersConfig(mockConfigService as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProcessRetryBatchActivity,
        { provide: ConfigService,             useValue: mockConfigService },
        { provide: LoggerFactory,             useValue: mockLoggerFactory },
        { provide: RedisService,              useValue: mockRedisService },
        { provide: CommandGenerationService,  useValue: mockCommandGenerationService },
        { provide: DirStreamingService,       useValue: mockDirStreamingService },
        { provide: DeferredDirStampService,   useValue: mockDeferredDirStampService },
      ],
    }).compile();

    activity = module.get<ProcessRetryBatchActivity>(ProcessRetryBatchActivity);
  });

  // ─── H1 ─────────────────────────────────────────────────────────────────────

  it('H1 — type="ops": batch retrieved from Redis, DirStreamingService streams the target directory into a Redis Set, CommandGenerationService.processItems generates commands, commands are bulk-published to the command stream, and batchDirs: [] is returned when there are no subdirectories', async () => {
    const opsBatch = {
      parentPath: '/parent/dir',
      operations: [{ id: 'op-1', fPath: '/file1.txt' }],
    };
    const jobCtx = makeJobContext(opsBatch);
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);

    mockDirStreamingService.streamDirToRedisSet.mockResolvedValue(undefined);
    mockCommandGenerationService.processItems.mockResolvedValue({
      commands: [{ id: 'cmd-1', fPath: '/file1.txt' }], subDirs: [],
    });

    const result = await activity.processRetryBatch({
      jobRunId: 'job-ret01',
      batchId: 'batch-ops-1',
      type: 'ops',
      batchSize: 100,
      settings: defaultSettings,
    });

    expect(jobCtx.getRetryBatch).toHaveBeenCalledWith('batch-ops-1');
    expect(mockDirStreamingService.streamDirToRedisSet).toHaveBeenCalled();
    expect(mockCommandGenerationService.processItems).toHaveBeenCalled();
    expect(jobCtx.publishBulkToCommandStream).toHaveBeenCalled();
    expect(result.batchDirs).toEqual([]);
  });

  // ─── H2 ─────────────────────────────────────────────────────────────────────

  it('H2 — type="ops" with duplicate fPath entries in operations: deduplication runs before processItems so each file path is only processed once', async () => {
    const opsBatch = {
      parentPath: '/parent/dir',
      operations: [
        { id: 'op-1', fPath: '/file1.txt' },
        { id: 'op-2', fPath: '/file1.txt' },
        { id: 'op-3', fPath: '/file2.txt' },
      ],
    };
    const jobCtx = makeJobContext(opsBatch);
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);

    mockDirStreamingService.streamDirToRedisSet.mockResolvedValue(undefined);
    mockCommandGenerationService.processItems.mockResolvedValue({
      commands: [{ id: 'cmd-1', fPath: '/file1.txt' }, { id: 'cmd-2', fPath: '/file2.txt' }],
      subDirs: [],
    });

    await activity.processRetryBatch({
      jobRunId: 'job-ret01',
      batchId: 'batch-dedup-1',
      type: 'ops',
      batchSize: 100,
      settings: defaultSettings,
    });

    const processItemsCall = mockCommandGenerationService.processItems.mock.calls[0][0];
    const itemPaths = processItemsCall.items.map((i: any) => i.fPath);
    expect(itemPaths).toEqual(['/file1.txt', '/file2.txt']);
    expect(itemPaths).toHaveLength(2);
  });

  // ─── H3 ─────────────────────────────────────────────────────────────────────

  it('H3 — type="ops" with subdirectories discovered: batchSubDirsWithTask creates a TaskInfo on the task stream, stores the commands in Redis, and the returned batchDirs contains the correct batch IDs', async () => {
    const opsBatch = {
      parentPath: '/parent/dir',
      operations: [{ id: 'op-1', fPath: '/file1.txt' }],
    };
    const jobCtx = makeJobContext(opsBatch);
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);

    mockDirStreamingService.streamDirToRedisSet.mockResolvedValue(undefined);
    mockCommandGenerationService.processItems.mockResolvedValue({
      commands: [{ id: 'cmd-1', fPath: '/file1.txt' }],
      subDirs: ['/parent/dir/sub1', '/parent/dir/sub2'],
    });

    const result = await activity.processRetryBatch({
      jobRunId: 'job-ret01',
      batchId: 'batch-subdirs-1',
      type: 'ops',
      batchSize: 100,
      settings: defaultSettings,
    });

    expect(result.batchDirs).toHaveLength(1);
    expect(jobCtx.publishToTaskStream).toHaveBeenCalled();
    expect(jobCtx.setBatchDir).toHaveBeenCalledWith(
      result.batchDirs[0],
      expect.any(Array),
    );
  });

  // ─── H4 ─────────────────────────────────────────────────────────────────────

  it('H4 — type="dir": directory commands are fetched from Redis, each directory is streamed via opendir() through DirStreamingService, resulting commands are published, and discovered subdirs are returned as new batch IDs', async () => {
    const dirCommands = [
      { id: 'cmd-dir-1', fPath: '/subdir1', isDir: true, status: 'READY', metadata: {} },
    ];
    const jobCtx = makeJobContext(null, dirCommands);
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);

    mockDirStreamingService.streamDirToRedisSet.mockResolvedValue(undefined);
    mockDirStreamingService.streamDirEntries.mockImplementation(async function* () {
      yield [{ name: 'file1.txt', fPath: '/subdir1/file1.txt' }];
    });
    mockCommandGenerationService.processItems.mockResolvedValue({
      commands: [{ id: 'cmd-1', fPath: '/subdir1/file1.txt' }], subDirs: [],
    });

    const result = await activity.processRetryBatch({
      jobRunId: 'job-ret01',
      batchId: 'batch-dir-1',
      type: 'dir',
      batchSize: 100,
      settings: defaultSettings,
    });

    expect(jobCtx.getBatchDir).toHaveBeenCalledWith('batch-dir-1');
    expect(jobCtx.getRetryBatch).not.toHaveBeenCalled();
    expect(mockDirStreamingService.streamDirEntries).toHaveBeenCalled();
    expect(result.batchDirs).toEqual([]);
  });

  // ─── N1 ─────────────────────────────────────────────────────────────────────

  it('N1 — type="ops" batch not found in Redis (getRetryBatch returns null): the method returns { batchDirs: [] } immediately without calling CommandGenerationService', async () => {
    const jobCtx = makeJobContext(null);
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);

    const result = await activity.processRetryBatch({
      jobRunId: 'job-ret01',
      batchId: 'batch-missing',
      type: 'ops',
      batchSize: 100,
      settings: defaultSettings,
    });

    expect(result.batchDirs).toEqual([]);
    expect(mockCommandGenerationService.processItems).not.toHaveBeenCalled();
  });

  // ─── N2 ─────────────────────────────────────────────────────────────────────

  it('N2 — type="dir" batch is empty or missing: same early return without any directory scanning', async () => {
    const jobCtx = makeJobContext(null, null);
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);

    const result = await activity.processRetryBatch({
      jobRunId: 'job-ret01',
      batchId: 'batch-dir-empty',
      type: 'dir',
      batchSize: 100,
      settings: defaultSettings,
    });

    expect(result.batchDirs).toEqual([]);
    expect(mockDirStreamingService.streamDirEntries).not.toHaveBeenCalled();
  });

  // ─── N3 ─────────────────────────────────────────────────────────────────────

  it('N3 — type="dir": one directory in a dir batch fails to scan with a non-fatal error — the per-directory catch logs the error, sets hasErrors = true, and processing continues for the remaining directories', async () => {
    const dirCommands = [
      { id: 'cmd-dir-1', fPath: '/subdir1', isDir: true, status: 'READY', metadata: {} },
      { id: 'cmd-dir-2', fPath: '/subdir2', isDir: true, status: 'READY', metadata: {} },
    ];
    const jobCtx = makeJobContext(null, dirCommands);
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);

    let callCount = 0;
    mockDirStreamingService.streamDirToRedisSet.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('Permission denied reading /subdir1');
      }
    });
    mockDirStreamingService.streamDirEntries.mockImplementation(async function* () {
      yield [{ name: 'file.txt', fPath: '/subdir2/file.txt' }];
    });
    mockCommandGenerationService.processItems.mockResolvedValue({
      commands: [{ id: 'cmd-1', fPath: '/subdir2/file.txt' }], subDirs: [],
    });

    const result = await activity.processRetryBatch({
      jobRunId: 'job-ret01',
      batchId: 'batch-dir-err',
      type: 'dir',
      batchSize: 100,
      settings: defaultSettings,
    });

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to scan retry subdirectory /subdir1'),
      expect.anything(),
    );
    expect(mockDirStreamingService.streamDirEntries).toHaveBeenCalled();
    expect(result.batchDirs).toEqual([]);
  });

  // ─── N4 ─────────────────────────────────────────────────────────────────────

  it('N4 — A FatalError is thrown by CommandGenerationService during either mode: it is re-thrown immediately (not wrapped in RetryableError), stopping processing', async () => {
    const opsBatch = {
      parentPath: '/parent',
      operations: [{ id: 'op-1', fPath: '/file1.txt' }],
    };
    const jobCtx = makeJobContext(opsBatch);
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);
    mockDirStreamingService.streamDirToRedisSet.mockResolvedValue(undefined);
    mockCommandGenerationService.processItems.mockRejectedValue(
      new FatalError('Target directory does not exist'),
    );

    await expect(
      activity.processRetryBatch({
        jobRunId: 'job-ret01',
        batchId: 'batch-fatal-1',
        type: 'ops',
        batchSize: 100,
        settings: defaultSettings,
      }),
    ).rejects.toBeInstanceOf(FatalError);
  });

  // ─── N5 ─────────────────────────────────────────────────────────────────────

  it('N5 — Redis getJobManagerContext itself throws a generic error: it is wrapped in a RetryableError so Temporal schedules a retry', async () => {
    mockRedisService.getJobManagerContext.mockRejectedValue(
      new Error('Redis connection lost'),
    );

    await expect(
      activity.processRetryBatch({
        jobRunId: 'job-ret01',
        batchId: 'batch-err-1',
        type: 'ops',
        batchSize: 100,
        settings: defaultSettings,
      }),
    ).rejects.toBeInstanceOf(RetryableError);
  });
});
