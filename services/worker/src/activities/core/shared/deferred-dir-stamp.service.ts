import { Inject, Injectable } from "@nestjs/common";
import { LoggerFactory, LoggerService } from "@netapp-cloud-datamigrate/logger-lib";
import { RedisService } from "src/redis/redis.service";

/**
 * A deferred record for re-stamping a directory's atime/mtime
 * after all its descendants have finished migrating.
 *
 * Directory mtimes/atimes are clobbered by every child write, so the
 * per-command STAMP_META done at COPY_DIR time is meaningless for
 * directories. Instead, we record the source timestamps here and
 * apply them in a single post-migration pass via RestampDirectoriesService.
 */
export interface DeferredDirStamp {
  /** Relative path under the destination prefix (e.g. "/foo/bar"). */
  fPath: string;
  /** Source atime in ISO string form (preserved across JSON). */
  atime: string;
  /** Source mtime in ISO string form. */
  mtime: string;
  /** Path depth — used to drain deepest-first (defensive ordering). */
  depth: number;
  /** Source ctime in ISO string form — used during post-migration restamp
   *  to detect permission changes that occurred after this folder was processed. */
  sourceCtime?: string;
}

/**
 * Default TTL applied to the underlying Redis keys at write time.
 * The post-migration pass deletes the keys explicitly via cleanup(),
 * but the TTL is a safety net so a crashed worker can't leak ZSET
 * entries forever.
 */
const DEFAULT_KEY_TTL_SECONDS = 24 * 60 * 60;

/**
 * Backs the deferred directory restamp queue with two Redis structures:
 *
 *   - ZSET `${jobRunId}:deferred-dir-stamps`           (score = -depth, member = fPath)
 *   - HASH `${jobRunId}:deferred-dir-stamps:meta`      (field  = fPath, value = JSON{atime,mtime})
 *
 * The ZSET handles ordering — `ZPOPMIN` against `-depth` drains the
 * deepest paths first, so a parent directory is always restamped *after*
 * all its descendants. The HASH carries the actual timestamps; using a
 * separate hash keyed by `fPath` means a re-scan of the same directory
 * naturally **deduplicates** instead of creating a second ZSET member
 * (the bug pattern when the JSON record is the ZSET value).
 *
 * All operations are best-effort: Redis errors during recording are
 * logged and swallowed — this is a post-correctness optimization, not a
 * data path that can fail the migration.
 */
@Injectable()
export class DeferredDirStampService {
  private readonly logger: LoggerService;

  constructor(
    private readonly redisService: RedisService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(DeferredDirStampService.name);
  }

  private orderKey(jobRunId: string): string {
    return `${jobRunId}:deferred-dir-stamps`;
  }

  private metaKey(jobRunId: string): string {
    return `${jobRunId}:deferred-dir-stamps:meta`;
  }

  /**
   * Compute path depth from a relative path. Counts non-empty segments,
   * tolerant of either '/' or '\\' separators. Must stay consistent with
   * how scan/migration constructs `Cmd.fPath` so deepest-first ordering
   * matches the actual filesystem hierarchy.
   */
  static computeDepth(fPath: string): number {
    if (!fPath) return 0;
    return fPath.split(/[\\/]+/).filter(Boolean).length;
  }

  async add(jobRunId: string, record: DeferredDirStamp): Promise<void> {
    if (!record?.fPath) return;
    try {
      const client = this.redisService.getClient();
      const orderKey = this.orderKey(jobRunId);
      const metaKey = this.metaKey(jobRunId);
      const payload = JSON.stringify({ atime: record.atime, mtime: record.mtime, sourceCtime: record.sourceCtime });

      // Store payload first so a successful ZADD always has a meta to read.
      await client.hSet(metaKey, record.fPath, payload);
      // ZADD with member=fPath dedupes naturally; re-adds simply update the score.
      await client.zAdd(orderKey, { score: -record.depth, value: record.fPath });

      // Best-effort TTLs — refreshed on every write. Migration cleanup() on
      // success deletes both keys explicitly.
      await client.expire(metaKey, DEFAULT_KEY_TTL_SECONDS);
      await client.expire(orderKey, DEFAULT_KEY_TTL_SECONDS);
    } catch (error) {
      this.logger.warn(`Failed to record deferred dir stamp for ${record.fPath}: ${error?.message ?? error}`);
    }
  }

  /**
   * Updates only the sourceCtime field in an existing deferred dir stamp record.
   * Called after stampMetaData completes for a directory, so the post-migration
   * restamp pass compares against the post-stamp ctime (T3) rather than the
   * scan-time ctime.
   */
  async updateSourceCtime(jobRunId: string, fPath: string, sourceCtime: string): Promise<void> {
    if (!fPath || !sourceCtime) return;
    try {
      const client = this.redisService.getClient();
      const metaKey = this.metaKey(jobRunId);
      const existing = await client.hGet(metaKey, fPath);
      if (!existing) return;
      const meta = JSON.parse(existing) as { atime: string; mtime: string; sourceCtime?: string };
      meta.sourceCtime = sourceCtime;
      await client.hSet(metaKey, fPath, JSON.stringify(meta));
    } catch (error) {
      this.logger.warn(`Failed to update sourceCtime for ${fPath}: ${error?.message ?? error}`);
    }
  }

  /**
   * Pops up to `batchSize` deepest entries (by ZPOPMIN against -depth) and
   * returns full DeferredDirStamp records by joining with the meta hash.
   * Entries whose meta is missing (already popped concurrently or expired)
   * are silently dropped.
   */
  async popBatch(jobRunId: string, batchSize: number): Promise<DeferredDirStamp[]> {
    if (batchSize <= 0) return [];
    const client = this.redisService.getClient();
    const orderKey = this.orderKey(jobRunId);
    const metaKey = this.metaKey(jobRunId);

    const popped = await client.zPopMinCount(orderKey, batchSize);
    if (!popped || popped.length === 0) return [];

    // Pull payloads in one round-trip.
    const fPaths = popped.map(p => p.value);
    const payloads = await client.hmGet(metaKey, fPaths);

    const records: DeferredDirStamp[] = [];
    const fPathsToDelete: string[] = [];
    for (let i = 0; i < popped.length; i++) {
      const fPath = popped[i].value;
      const score = popped[i].score;
      const payloadStr = payloads[i];
      if (!payloadStr) continue;
      try {
        const meta = JSON.parse(payloadStr) as { atime: string; mtime: string; sourceCtime?: string };
        if (meta?.atime && meta?.mtime) {
          records.push({ fPath, atime: meta.atime, mtime: meta.mtime, depth: -score, sourceCtime: meta.sourceCtime });
          fPathsToDelete.push(fPath);
        }
      } catch (error) {
        this.logger.warn(`Skipping malformed deferred dir stamp meta for ${fPath}: ${error?.message ?? error}`);
        fPathsToDelete.push(fPath);
      }
    }

    if (fPathsToDelete.length > 0) {
      try {
        await client.hDel(metaKey, fPathsToDelete);
      } catch (error) {
        // Tolerable — TTL or final cleanup() will collect the leftovers.
        this.logger.warn(`Failed to clear ${fPathsToDelete.length} deferred dir stamp meta entries: ${error?.message ?? error}`);
      }
    }

    return records;
  }

  async count(jobRunId: string): Promise<number> {
    const client = this.redisService.getClient();
    return client.zCard(this.orderKey(jobRunId));
  }

  /**
   * Deletes both the order and meta keys for the given job. Safe to call
   * multiple times. Should be invoked at the end of the restamp pass and
   * also as a defensive sweep on workflow failure / cleanup.
   */
  async cleanup(jobRunId: string): Promise<void> {
    try {
      const client = this.redisService.getClient();
      await client.del([this.orderKey(jobRunId), this.metaKey(jobRunId)]);
    } catch (error) {
      this.logger.warn(`Failed to cleanup deferred dir stamps for ${jobRunId}: ${error?.message ?? error}`);
    }
  }
}
