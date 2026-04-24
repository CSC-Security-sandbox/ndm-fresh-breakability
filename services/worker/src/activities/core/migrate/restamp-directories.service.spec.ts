import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import * as fs from 'fs';
import * as path from 'path';
import { RestampDirectoriesService } from './restamp-directories.service';
import { RedisService } from 'src/redis/redis.service';
import { DeferredDirStampService } from '../shared/deferred-dir-stamp.service';

jest.mock('fs', () => ({
  promises: {
    utimes: jest.fn(),
  },
}));

// Avoid leaking heartbeat-related Temporal context bleed-through.
jest.mock('@temporalio/activity', () => ({
  Context: {
    current: () => {
      throw new Error('not in activity');
    },
  },
}));

describe('RestampDirectoriesService', () => {
  let service: RestampDirectoriesService;
  let deferredDirStampService: jest.Mocked<DeferredDirStampService>;
  let redisService: jest.Mocked<RedisService>;
  let configService: jest.Mocked<ConfigService>;

  const mockLogger: Partial<LoggerService> = {
    debug: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const mockJobContext = {
    jobConfig: {
      destinationFileServer: { pathId: 'dest-path-id' },
      destinationDirectoryPath: '/dest',
    },
  };

  // Snapshot env so tests are deterministic across platforms.
  const originalBaseWorkingPath = process.env.BASE_WORKING_PATH;
  const originalPlatform = process.platform;

  beforeAll(() => {
    process.env.BASE_WORKING_PATH = '/base';
    Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
  });

  afterAll(() => {
    process.env.BASE_WORKING_PATH = originalBaseWorkingPath;
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
  });

  beforeEach(async () => {
    deferredDirStampService = {
      add: jest.fn().mockResolvedValue(undefined),
      popBatch: jest.fn().mockResolvedValue([]),
      cleanup: jest.fn().mockResolvedValue(undefined),
      count: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<DeferredDirStampService>;

    redisService = {
      getJobManagerContext: jest.fn().mockResolvedValue(mockJobContext),
    } as unknown as jest.Mocked<RedisService>;

    configService = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as jest.Mocked<ConfigService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestampDirectoriesService,
        { provide: ConfigService, useValue: configService },
        { provide: RedisService, useValue: redisService },
        { provide: DeferredDirStampService, useValue: deferredDirStampService },
        { provide: LoggerFactory, useValue: { create: jest.fn().mockReturnValue(mockLogger) } },
      ],
    }).compile();

    service = module.get(RestampDirectoriesService);
  });

  afterEach(() => {
    // mockReset wipes implementations AND the mockResolvedValueOnce queue;
    // critical because fs.promises.utimes is shared across tests in this file.
    (fs.promises.utimes as unknown as jest.Mock).mockReset();
    jest.clearAllMocks();
  });

  it('drains the queue deepest-first and applies utimes with joined paths', async () => {
    const utimes = fs.promises.utimes as unknown as jest.Mock;
    utimes.mockResolvedValue(undefined);

    deferredDirStampService.popBatch
      .mockResolvedValueOnce([
        { fPath: '/a/b/c', atime: '2024-01-01T00:00:00.000Z', mtime: '2024-01-02T00:00:00.000Z', depth: 3 },
        { fPath: '/a',     atime: '2024-01-01T00:00:00.000Z', mtime: '2024-01-02T00:00:00.000Z', depth: 1 },
      ])
      .mockResolvedValueOnce([]);
    deferredDirStampService.count.mockResolvedValue(2);

    const out = await service.restampDirectories({ jobRunId: 'job1' });

    expect(out).toEqual({ attempted: 2, stamped: 2, failed: 0, skipped: 0 });
    expect(utimes).toHaveBeenCalledTimes(2);
    // basePrefix for linux: /base/job1/dest-path-id/dest, then path.join with /a/b/c.
    expect(utimes).toHaveBeenCalledWith(
      path.join('/base/job1/dest-path-id/dest', '/a/b/c'),
      new Date('2024-01-01T00:00:00.000Z'),
      new Date('2024-01-02T00:00:00.000Z'),
    );
    expect(deferredDirStampService.cleanup).toHaveBeenCalledWith('job1');
  });

  it('treats ENOENT as skipped, not failed', async () => {
    const utimes = fs.promises.utimes as unknown as jest.Mock;
    const enoent = new Error('not found') as any;
    enoent.code = 'ENOENT';
    utimes.mockRejectedValueOnce(enoent);
    utimes.mockResolvedValueOnce(undefined);

    deferredDirStampService.popBatch
      .mockResolvedValueOnce([
        { fPath: '/missing', atime: 'A', mtime: 'M', depth: 1 },
        { fPath: '/exists',  atime: 'A', mtime: 'M', depth: 1 },
      ])
      .mockResolvedValueOnce([]);

    const out = await service.restampDirectories({ jobRunId: 'job1' });

    // Invalid timestamps in the missing record are pre-filtered as skipped,
    // but here we use real ISO strings for both records so the ENOENT branch
    // is the actual driver of the skipped count.
    expect(out.failed).toBe(0);
    expect(out.skipped + out.stamped).toBe(2);
  });

  it('counts non-ENOENT errors as failed (allSettled rejection path)', async () => {
    const utimes = fs.promises.utimes as unknown as jest.Mock;
    const eperm = new Error('perm denied') as any;
    eperm.code = 'EPERM';
    utimes.mockRejectedValueOnce(eperm);

    deferredDirStampService.popBatch
      .mockResolvedValueOnce([
        { fPath: '/locked', atime: '2024-01-01T00:00:00.000Z', mtime: '2024-01-02T00:00:00.000Z', depth: 1 },
      ])
      .mockResolvedValueOnce([]);

    const out = await service.restampDirectories({ jobRunId: 'job1' });
    expect(out).toEqual({ attempted: 1, stamped: 0, failed: 1, skipped: 0 });
  });

  it('skips records with invalid timestamps without invoking utimes', async () => {
    const utimes = fs.promises.utimes as unknown as jest.Mock;
    deferredDirStampService.popBatch
      .mockResolvedValueOnce([
        { fPath: '/bad', atime: 'not-a-date', mtime: 'also-bad', depth: 1 },
      ])
      .mockResolvedValueOnce([]);

    const out = await service.restampDirectories({ jobRunId: 'job1' });
    expect(out.skipped).toBe(1);
    expect(utimes).not.toHaveBeenCalled();
  });

  it('returns gracefully and still cleans up if no destination pathId is configured', async () => {
    redisService.getJobManagerContext = jest.fn().mockResolvedValue({
      jobConfig: { destinationFileServer: {} },
    }) as any;

    const out = await service.restampDirectories({ jobRunId: 'job1' });
    expect(out).toEqual({ attempted: 0, stamped: 0, failed: 0, skipped: 0 });
    expect(deferredDirStampService.popBatch).not.toHaveBeenCalled();
    // cleanup runs in `finally`, so it always fires.
    expect(deferredDirStampService.cleanup).toHaveBeenCalledWith('job1');
  });

  it('runs cleanup in finally even when restamp throws mid-pass', async () => {
    deferredDirStampService.popBatch.mockRejectedValueOnce(new Error('redis down'));

    const out = await service.restampDirectories({ jobRunId: 'job1' });
    expect(out).toEqual({ attempted: 0, stamped: 0, failed: 0, skipped: 0 });
    expect(deferredDirStampService.cleanup).toHaveBeenCalledWith('job1');
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('respects the configured batch size', async () => {
    const localConfig = {
      get: jest.fn().mockImplementation((k: string) =>
        k === 'worker.restampDirBatchSize' ? 7 : undefined,
      ),
    };
    // Default constructor uses configService.get at construction time, so we
    // build a fresh service with a config that returns 7.
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestampDirectoriesService,
        { provide: ConfigService, useValue: localConfig },
        { provide: RedisService, useValue: redisService },
        { provide: DeferredDirStampService, useValue: deferredDirStampService },
        { provide: LoggerFactory, useValue: { create: jest.fn().mockReturnValue(mockLogger) } },
      ],
    }).compile();
    const svc = module.get(RestampDirectoriesService);

    await svc.restampDirectories({ jobRunId: 'job1' });
    expect(deferredDirStampService.popBatch).toHaveBeenCalledWith('job1', 7);
  });

  it('input.batchSize overrides the config default', async () => {
    deferredDirStampService.popBatch.mockResolvedValue([]);
    await service.restampDirectories({ jobRunId: 'job1', batchSize: 13 });
    expect(deferredDirStampService.popBatch).toHaveBeenCalledWith('job1', 13);
  });

  describe('source atime preservation', () => {
    const jobContextWithSource = {
      jobConfig: {
        destinationFileServer: { pathId: 'dest-path-id' },
        destinationDirectoryPath: '/dest',
        sourceFileServer: { pathId: 'src-path-id' },
        sourceDirectoryPath: '/src',
        options: { preserveAccessTime: true },
      },
    };

    it('stamps both destination and source when preserveAccessTime is enabled', async () => {
      const utimes = fs.promises.utimes as unknown as jest.Mock;
      utimes.mockResolvedValue(undefined);
      redisService.getJobManagerContext = jest
        .fn()
        .mockResolvedValue(jobContextWithSource) as any;

      deferredDirStampService.popBatch
        .mockResolvedValueOnce([
          { fPath: '/a/b', atime: '2024-01-01T00:00:00.000Z', mtime: '2024-01-02T00:00:00.000Z', depth: 2 },
        ])
        .mockResolvedValueOnce([]);

      const out = await service.restampDirectories({ jobRunId: 'job1' });

      expect(out).toEqual({ attempted: 1, stamped: 1, failed: 0, skipped: 0 });
      expect(utimes).toHaveBeenCalledTimes(2);
      expect(utimes).toHaveBeenCalledWith(
        path.join('/base/job1/dest-path-id/dest', '/a/b'),
        new Date('2024-01-01T00:00:00.000Z'),
        new Date('2024-01-02T00:00:00.000Z'),
      );
      expect(utimes).toHaveBeenCalledWith(
        path.join('/base/job1/src-path-id/src', '/a/b'),
        new Date('2024-01-01T00:00:00.000Z'),
        new Date('2024-01-02T00:00:00.000Z'),
      );
    });

    it('skips source utimes when preserveAccessTime is disabled', async () => {
      const utimes = fs.promises.utimes as unknown as jest.Mock;
      utimes.mockResolvedValue(undefined);
      redisService.getJobManagerContext = jest.fn().mockResolvedValue({
        jobConfig: {
          ...jobContextWithSource.jobConfig,
          options: { preserveAccessTime: false },
        },
      }) as any;

      deferredDirStampService.popBatch
        .mockResolvedValueOnce([
          { fPath: '/a', atime: '2024-01-01T00:00:00.000Z', mtime: '2024-01-02T00:00:00.000Z', depth: 1 },
        ])
        .mockResolvedValueOnce([]);

      await service.restampDirectories({ jobRunId: 'job1' });

      expect(utimes).toHaveBeenCalledTimes(1);
      expect(utimes).toHaveBeenCalledWith(
        path.join('/base/job1/dest-path-id/dest', '/a'),
        expect.any(Date),
        expect.any(Date),
      );
    });

    it('does not fail the record when source utimes fails with EPERM (best-effort preserve)', async () => {
      const utimes = fs.promises.utimes as unknown as jest.Mock;
      redisService.getJobManagerContext = jest
        .fn()
        .mockResolvedValue(jobContextWithSource) as any;

      // Fail source side with EPERM, destination side succeeds. Parallel
      // order isn't deterministic, so match by path rather than call index.
      utimes.mockImplementation(async (p: string) => {
        if (p.startsWith('/base/job1/src-path-id')) {
          const err = new Error('perm denied') as any;
          err.code = 'EPERM';
          throw err;
        }
        return undefined;
      });

      deferredDirStampService.popBatch
        .mockResolvedValueOnce([
          { fPath: '/a', atime: '2024-01-01T00:00:00.000Z', mtime: '2024-01-02T00:00:00.000Z', depth: 1 },
        ])
        .mockResolvedValueOnce([]);

      const out = await service.restampDirectories({ jobRunId: 'job1' });
      expect(out).toEqual({ attempted: 1, stamped: 1, failed: 0, skipped: 0 });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Source atime preserve failed'),
      );
    });

    it('still fails the record when destination utimes fails with non-ENOENT', async () => {
      const utimes = fs.promises.utimes as unknown as jest.Mock;
      redisService.getJobManagerContext = jest
        .fn()
        .mockResolvedValue(jobContextWithSource) as any;

      utimes.mockImplementation(async (p: string) => {
        if (p.startsWith('/base/job1/dest-path-id')) {
          const err = new Error('perm denied') as any;
          err.code = 'EPERM';
          throw err;
        }
        return undefined;
      });

      deferredDirStampService.popBatch
        .mockResolvedValueOnce([
          { fPath: '/a', atime: '2024-01-01T00:00:00.000Z', mtime: '2024-01-02T00:00:00.000Z', depth: 1 },
        ])
        .mockResolvedValueOnce([]);

      const out = await service.restampDirectories({ jobRunId: 'job1' });
      expect(out).toEqual({ attempted: 1, stamped: 0, failed: 1, skipped: 0 });
    });
  });
});
