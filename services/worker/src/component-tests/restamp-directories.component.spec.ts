import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RestampDirectoriesService } from '../activities/core/migrate/restamp-directories.service';
import { DeferredDirStampService } from '../activities/core/shared/deferred-dir-stamp.service';
import { RedisService } from '../redis/redis.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { WorkersConfig } from '../config/app.config';

jest.mock('@temporalio/activity', () => ({
  Context: {
    current: jest.fn().mockReturnValue({ heartbeat: jest.fn() }),
  },
}));

jest.mock('fs', () => ({
  promises: {
    utimes: jest.fn(),
  },
}));
import * as fs from 'fs';
const mockedUtimes = (fs.promises as any).utimes as jest.Mock;

/**
 * Real classes wired:
 *   RestampDirectoriesService → DeferredDirStampService (mock: popBatch, count, cleanup)
 *
 * Mocked boundaries:
 *   RedisService.getJobManagerContext  — returns mock jobContext
 *   DeferredDirStampService.popBatch   — returns deferred stamp records
 *   fs.promises.utimes                 — sets timestamps on dest directory
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
      'worker.restampDirBatchSize': 500,
    };
    return map[key];
  }),
};

const mockRedisService           = { getJobManagerContext: jest.fn() };
const mockDeferredDirStampService = {
  count:    jest.fn().mockResolvedValue(0),
  popBatch: jest.fn(),
  cleanup:  jest.fn().mockResolvedValue(undefined),
};

function makeJobContext(pathIdOverride?: string | null) {
  return {
    jobConfig: {
      jobRunId: 'job-rst01',
      destinationFileServer: { pathId: pathIdOverride !== undefined ? pathIdOverride : 'dst-path', hostname: '10.0.0.2' },
      sourceFileServer:      { pathId: 'src-path', hostname: '10.0.0.1' },
      destinationDirectoryPath: '/mnt/worker/job-rst01/dst-path',
      sourceDirectoryPath:      '/mnt/worker/job-rst01/src-path',
    },
    jobRunId: 'job-rst01',
    publishToErrorStream: jest.fn().mockResolvedValue(undefined),
  };
}

function makeStampRecord(fPath: string, atime = '2024-01-01T00:00:00Z', mtime = '2024-01-02T00:00:00Z') {
  return { fPath, atime, mtime, depth: fPath.split('/').length - 1 };
}

describe('Component: restampDirectories (RestampDirectoriesService)', () => {
  let service: RestampDirectoriesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    new WorkersConfig(mockConfigService as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestampDirectoriesService,
        { provide: ConfigService,             useValue: mockConfigService },
        { provide: LoggerFactory,             useValue: mockLoggerFactory },
        { provide: RedisService,              useValue: mockRedisService },
        { provide: DeferredDirStampService,   useValue: mockDeferredDirStampService },
      ],
    }).compile();

    service = module.get<RestampDirectoriesService>(RestampDirectoriesService);
  });

  // ─── H1 ─────────────────────────────────────────────────────────────────────

  it('H1 — Happy path: DeferredDirStampService.popBatch returns one batch of entries, each has valid atime/mtime, fs.promises.utimes succeeds on the first attempt, all are counted as stamped, and cleanup is called in the finally block', async () => {
    const jobCtx = makeJobContext();
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);

    const records = [
      makeStampRecord('/dir1'),
      makeStampRecord('/dir2'),
    ];
    mockDeferredDirStampService.popBatch
      .mockResolvedValueOnce(records)
      .mockResolvedValueOnce([]);

    mockedUtimes.mockResolvedValue(undefined);

    const result = await service.restampDirectories({ jobRunId: 'job-rst01' });

    expect(mockedUtimes).toHaveBeenCalledTimes(2);
    expect(result.stamped).toBe(2);
    expect(result.failed).toBe(0);
    expect(mockDeferredDirStampService.cleanup).toHaveBeenCalledWith('job-rst01');
  });

  // ─── H2 ─────────────────────────────────────────────────────────────────────

  it('H2 — Multiple batches: first popBatch returns a full batch, second returns an empty array — verify the while-loop exits cleanly and the aggregate attempted/stamped counts are correct across both batches', async () => {
    const jobCtx = makeJobContext();
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);

    const batch1 = [makeStampRecord('/dir1'), makeStampRecord('/dir2')];
    const batch2 = [makeStampRecord('/dir3')];
    mockDeferredDirStampService.popBatch
      .mockResolvedValueOnce(batch1)
      .mockResolvedValueOnce(batch2)
      .mockResolvedValueOnce([]);

    mockedUtimes.mockResolvedValue(undefined);

    const result = await service.restampDirectories({ jobRunId: 'job-rst01' });

    expect(mockedUtimes).toHaveBeenCalledTimes(3);
    expect(result.stamped).toBe(3);
    expect(result.attempted).toBe(3);
    expect(mockDeferredDirStampService.cleanup).toHaveBeenCalled();
  });

  // ─── H3 ─────────────────────────────────────────────────────────────────────

  it('H3 — No destination pathId on the job config: the method returns the zeroed output immediately without calling DeferredDirStampService at all', async () => {
    const jobCtx = makeJobContext(null);
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);

    const result = await service.restampDirectories({ jobRunId: 'job-rst01' });

    expect(result.attempted).toBe(0);
    expect(result.stamped).toBe(0);
    expect(mockDeferredDirStampService.popBatch).not.toHaveBeenCalled();
  });

  // ─── H4 ─────────────────────────────────────────────────────────────────────

  it('H4 — utimes is called with the correct Date objects derived from the record atime and mtime ISO strings', async () => {
    const jobCtx = makeJobContext();
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);

    const record = makeStampRecord('/dir4', '2024-06-15T10:30:00Z', '2024-06-16T12:00:00Z');
    mockDeferredDirStampService.popBatch
      .mockResolvedValueOnce([record])
      .mockResolvedValueOnce([]);

    mockedUtimes.mockResolvedValue(undefined);

    const result = await service.restampDirectories({ jobRunId: 'job-rst01' });

    expect(result.stamped).toBe(1);
    expect(mockedUtimes).toHaveBeenCalledWith(
      expect.any(String),
      new Date('2024-06-15T10:30:00Z'),
      new Date('2024-06-16T12:00:00Z'),
    );
  });

  // ─── N1 ─────────────────────────────────────────────────────────────────────

  it('N1 — utimes fails with ENOENT (destination directory was deleted): the entry is counted as skipped, no error is published, and the rest of the batch continues via Promise.allSettled', async () => {
    const jobCtx = makeJobContext();
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);

    mockDeferredDirStampService.popBatch
      .mockResolvedValueOnce([makeStampRecord('/missing-dir')])
      .mockResolvedValueOnce([]);

    mockedUtimes.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const result = await service.restampDirectories({ jobRunId: 'job-rst01' });

    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
    expect(jobCtx.publishToErrorStream).not.toHaveBeenCalled();
  });

  // ─── N2 ─────────────────────────────────────────────────────────────────────

  it('N2 — utimes fails with a transient error (e.g., EBUSY): the local retry loop retries up to 3 times with backoff, then publishes a STAMP_TIME dmError to the error stream and counts the entry as failed', async () => {
    const jobCtx = makeJobContext();
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);

    mockDeferredDirStampService.popBatch
      .mockResolvedValueOnce([makeStampRecord('/no-perm-dir')])
      .mockResolvedValueOnce([]);

    mockedUtimes.mockRejectedValue(Object.assign(new Error('resource busy'), { code: 'EBUSY' }));

    const result = await service.restampDirectories({ jobRunId: 'job-rst01' });

    expect(result.failed).toBe(1);
    expect(jobCtx.publishToErrorStream).toHaveBeenCalled();
    expect(mockedUtimes).toHaveBeenCalledTimes(3);
  }, 10000);

  // ─── N3 ─────────────────────────────────────────────────────────────────────

  it('N3 — An entry has a null or invalid timestamp string: applyStamp returns "skipped" immediately without calling utimes', async () => {
    const jobCtx = makeJobContext();
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);

    const badRecord = makeStampRecord('/dir3', 'INVALID-DATE', 'ALSO-INVALID');
    mockDeferredDirStampService.popBatch
      .mockResolvedValueOnce([badRecord])
      .mockResolvedValueOnce([]);

    const result = await service.restampDirectories({ jobRunId: 'job-rst01' });

    expect(mockedUtimes).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.stamped).toBe(0);
  });

  // ─── N4 ─────────────────────────────────────────────────────────────────────

  it('N4 — getJobManagerContext throws: the error propagates out of restampDirectories (re-thrown), but cleanup is still called in the finally block', async () => {
    mockRedisService.getJobManagerContext.mockRejectedValue(new Error('Redis unavailable'));

    await expect(
      service.restampDirectories({ jobRunId: 'job-rst01' }),
    ).rejects.toThrow('Redis unavailable');

    expect(mockDeferredDirStampService.cleanup).toHaveBeenCalledWith('job-rst01');
  });
});
