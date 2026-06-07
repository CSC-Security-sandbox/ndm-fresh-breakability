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
  /**
   * Absolute UNC destination to write the mtime to, bypassing the local
   * junction. Set only for the DLM root, whose scan-time mtime read is done
   * over UNC (`initDlmRootStamp` lstats the share directly). Writing the
   * mtime through the same UNC path the gate reads back guarantees the value
   * round-trips; writing through the local `mklink /D` junction does not —
   * the reparse boundary to the remote share need not persist it, so the gate
   * sees drift and re-stamps the root on every incremental. Absent for
   * ordinary subdirectories, which are read and written through the same
   * local junction path and are therefore already self-consistent.
   */
  uncTargetPath?: string;
}

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
      // JSON.stringify omits undefined fields, so a record without
      // uncTargetPath serializes identically to the legacy {atime,mtime}
      // payload — no migration needed for in-flight entries.
      const payload = JSON.stringify({ atime: record.atime, mtime: record.mtime, uncTargetPath: record.uncTargetPath });

      // Store payload first so a successful ZADD always has a meta to read.
      await client.hSet(metaKey, record.fPath, payload);
      // ZADD with member=fPath dedupes naturally; re-adds simply update the score.
      await client.zAdd(orderKey, { score: -record.depth, value: record.fPath });
    } catch (error) {
      this.logger.warn(`Failed to record deferred dir stamp for ${record.fPath}: ${error?.message ?? error}`);
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
        const meta = JSON.parse(payloadStr) as { atime: string; mtime: string; uncTargetPath?: string };
        if (meta?.atime && meta?.mtime) {
          records.push({
            fPath,
            atime: meta.atime,
            mtime: meta.mtime,
            depth: -score,
            ...(meta.uncTargetPath ? { uncTargetPath: meta.uncTargetPath } : {}),
          });
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
