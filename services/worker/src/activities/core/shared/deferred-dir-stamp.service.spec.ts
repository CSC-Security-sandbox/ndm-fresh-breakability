import { Test, TestingModule } from '@nestjs/testing';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { DeferredDirStampService } from './deferred-dir-stamp.service';
import { RedisService } from 'src/redis/redis.service';

describe('DeferredDirStampService', () => {
  let service: DeferredDirStampService;
  let redisClient: {
    hSet: jest.Mock;
    zAdd: jest.Mock;
    zPopMinCount: jest.Mock;
    hmGet: jest.Mock;
    hDel: jest.Mock;
    zCard: jest.Mock;
    del: jest.Mock;
  };

  const mockLogger: Partial<LoggerService> = {
    debug: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(async () => {
    redisClient = {
      hSet: jest.fn().mockResolvedValue(1),
      zAdd: jest.fn().mockResolvedValue(1),
      zPopMinCount: jest.fn().mockResolvedValue([]),
      hmGet: jest.fn().mockResolvedValue([]),
      hDel: jest.fn().mockResolvedValue(0),
      zCard: jest.fn().mockResolvedValue(0),
      del: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeferredDirStampService,
        { provide: RedisService, useValue: { getClient: () => redisClient } },
        {
          provide: LoggerFactory,
          useValue: { create: jest.fn().mockReturnValue(mockLogger) },
        },
      ],
    }).compile();

    service = module.get(DeferredDirStampService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('computeDepth', () => {
    it('returns 0 for empty path', () => {
      expect(DeferredDirStampService.computeDepth('')).toBe(0);
      expect(DeferredDirStampService.computeDepth(undefined as any)).toBe(0);
    });
    it('counts non-empty segments only (leading/trailing slashes ignored)', () => {
      expect(DeferredDirStampService.computeDepth('/a')).toBe(1);
      expect(DeferredDirStampService.computeDepth('/a/b/c')).toBe(3);
      expect(DeferredDirStampService.computeDepth('/a/b/c/')).toBe(3);
      expect(DeferredDirStampService.computeDepth('a//b')).toBe(2);
    });
    it('handles backslash separators (defensive)', () => {
      expect(DeferredDirStampService.computeDepth('\\a\\b')).toBe(2);
    });
  });

  describe('add', () => {
    const record = {
      fPath: '/foo/bar',
      atime: '2024-01-01T00:00:00.000Z',
      mtime: '2024-01-02T00:00:00.000Z',
      depth: 2,
    };

    it('writes meta first, then ZSET', async () => {
      await service.add('job1', record);

      expect(redisClient.hSet).toHaveBeenCalledWith(
        'job1:deferred-dir-stamps:meta',
        '/foo/bar',
        JSON.stringify({ atime: record.atime, mtime: record.mtime }),
      );
      expect(redisClient.zAdd).toHaveBeenCalledWith(
        'job1:deferred-dir-stamps',
        { score: -2, value: '/foo/bar' },
      );
    });

    it('dedupes — re-adding the same fPath updates the existing ZSET member', async () => {
      // node-redis ZADD returns 0 when the member already existed (score may
      // have been updated). Both writes should still go through and not throw.
      redisClient.zAdd
        .mockResolvedValueOnce(1) // first add: new member
        .mockResolvedValueOnce(0); // second add: existing member, score updated

      await service.add('job1', record);
      await service.add('job1', { ...record, depth: 5 });

      expect(redisClient.zAdd).toHaveBeenNthCalledWith(1, 'job1:deferred-dir-stamps', { score: -2, value: '/foo/bar' });
      expect(redisClient.zAdd).toHaveBeenNthCalledWith(2, 'job1:deferred-dir-stamps', { score: -5, value: '/foo/bar' });
      // hSet has been called twice on the same field, which is the correct
      // last-write-wins semantics for the timestamp meta.
      expect(redisClient.hSet).toHaveBeenCalledTimes(2);
    });

    it('is a no-op for a record without fPath', async () => {
      await service.add('job1', { fPath: '', atime: 'x', mtime: 'y', depth: 0 });
      expect(redisClient.hSet).not.toHaveBeenCalled();
      expect(redisClient.zAdd).not.toHaveBeenCalled();
    });

    it('swallows Redis errors (best-effort)', async () => {
      redisClient.hSet.mockRejectedValueOnce(new Error('redis down'));
      await expect(service.add('job1', record)).resolves.toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('popBatch', () => {
    it('returns empty array when batchSize <= 0', async () => {
      await expect(service.popBatch('job1', 0)).resolves.toEqual([]);
      expect(redisClient.zPopMinCount).not.toHaveBeenCalled();
    });

    it('joins ZPOPMIN result with HMGET payloads and HDELs them', async () => {
      redisClient.zPopMinCount.mockResolvedValueOnce([
        { value: '/a/b/c', score: -3 },
        { value: '/a', score: -1 },
      ]);
      redisClient.hmGet.mockResolvedValueOnce([
        JSON.stringify({ atime: 'A1', mtime: 'M1' }),
        JSON.stringify({ atime: 'A2', mtime: 'M2' }),
      ]);

      const out = await service.popBatch('job1', 50);

      expect(out).toEqual([
        { fPath: '/a/b/c', atime: 'A1', mtime: 'M1', depth: 3 },
        { fPath: '/a', atime: 'A2', mtime: 'M2', depth: 1 },
      ]);
      expect(redisClient.hDel).toHaveBeenCalledWith(
        'job1:deferred-dir-stamps:meta',
        ['/a/b/c', '/a'],
      );
    });

    it('drops entries whose meta is missing', async () => {
      redisClient.zPopMinCount.mockResolvedValueOnce([
        { value: '/keep', score: -2 },
        { value: '/missing', score: -1 },
      ]);
      redisClient.hmGet.mockResolvedValueOnce([
        JSON.stringify({ atime: 'A', mtime: 'M' }),
        null,
      ]);

      const out = await service.popBatch('job1', 10);

      expect(out).toEqual([{ fPath: '/keep', atime: 'A', mtime: 'M', depth: 2 }]);
      // /missing must NOT be HDELed — there's nothing to delete and we don't
      // want to swallow possible meta arriving via a race.
      expect(redisClient.hDel).toHaveBeenCalledWith(
        'job1:deferred-dir-stamps:meta',
        ['/keep'],
      );
    });

    it('drops malformed payloads but cleans them up', async () => {
      redisClient.zPopMinCount.mockResolvedValueOnce([
        { value: '/junk', score: -1 },
      ]);
      redisClient.hmGet.mockResolvedValueOnce(['{not json']);
      const out = await service.popBatch('job1', 10);
      expect(out).toEqual([]);
      expect(redisClient.hDel).toHaveBeenCalledWith(
        'job1:deferred-dir-stamps:meta',
        ['/junk'],
      );
    });

    it('returns deepest-first ordering naturally (driven by ZPOPMIN with -depth)', async () => {
      // ZPOPMIN returns members ordered by ascending score. Since we store
      // score = -depth, the smallest score is the deepest path.
      redisClient.zPopMinCount.mockResolvedValueOnce([
        { value: '/a/b/c', score: -3 }, // deepest first
        { value: '/a/b',   score: -2 },
        { value: '/a',     score: -1 },
      ]);
      redisClient.hmGet.mockResolvedValueOnce([
        JSON.stringify({ atime: 'A', mtime: 'M' }),
        JSON.stringify({ atime: 'A', mtime: 'M' }),
        JSON.stringify({ atime: 'A', mtime: 'M' }),
      ]);
      const out = await service.popBatch('job1', 10);
      expect(out.map(r => r.fPath)).toEqual(['/a/b/c', '/a/b', '/a']);
      expect(out.map(r => r.depth)).toEqual([3, 2, 1]);
    });
  });

  describe('cleanup', () => {
    it('deletes both order and meta keys', async () => {
      await service.cleanup('job1');
      expect(redisClient.del).toHaveBeenCalledWith([
        'job1:deferred-dir-stamps',
        'job1:deferred-dir-stamps:meta',
      ]);
    });

    it('swallows del errors', async () => {
      redisClient.del.mockRejectedValueOnce(new Error('boom'));
      await expect(service.cleanup('job1')).resolves.toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('count', () => {
    it('returns ZCARD of the order key', async () => {
      redisClient.zCard.mockResolvedValueOnce(42);
      await expect(service.count('job1')).resolves.toBe(42);
      expect(redisClient.zCard).toHaveBeenCalledWith('job1:deferred-dir-stamps');
    });
  });
});
