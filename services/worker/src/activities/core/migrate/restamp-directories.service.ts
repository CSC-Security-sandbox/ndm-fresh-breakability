import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JobManagerContext } from "@netapp-cloud-datamigrate/jobs-lib";
import { LoggerFactory, LoggerService } from "@netapp-cloud-datamigrate/logger-lib";
import { Context } from "@temporalio/activity";
import * as fs from "fs";
import * as path from "path";
import { basePrefix } from "src/activities/utils/utils";
import { RedisService } from "src/redis/redis.service";
import { DeferredDirStamp, DeferredDirStampService } from "../shared/deferred-dir-stamp.service";

export interface RestampDirectoriesInput {
  jobRunId: string;
  /** Optional override for batch size; defaults to `worker.restampDirBatchSize` config or 500. */
  batchSize?: number;
}

export interface RestampDirectoriesOutput {
  attempted: number;
  stamped: number;
  failed: number;
  skipped: number;
}

/**
 * Post-migration activity that drains the `${jobRunId}:deferred-dir-stamps`
 * sorted set and re-applies the source directory mtime/atime onto the
 * destination directories. Order is deepest-first (ZPOPMIN against `-depth`),
 * so a parent dir's timestamps are stamped after all its descendants — child
 * writes can never clobber a parent's mtime once the post-pass has run.
 *
 * This activity is idempotent and safe to run more than once; redoing the
 * stamp on an already-correct dir is a no-op.
 */
@Injectable()
export class RestampDirectoriesService {
  private readonly logger: LoggerService;
  private readonly defaultBatchSize: number;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly redisService: RedisService,
    private readonly deferredDirStampService: DeferredDirStampService,
  ) {
    this.logger = loggerFactory.create(RestampDirectoriesService.name);
    this.defaultBatchSize = this.configService.get<number>("worker.restampDirBatchSize") || 500;
  }

  async restampDirectories(input: RestampDirectoriesInput): Promise<RestampDirectoriesOutput> {
    const { jobRunId } = input;
    const batchSize = input.batchSize ?? this.defaultBatchSize;
    const output: RestampDirectoriesOutput = { attempted: 0, stamped: 0, failed: 0, skipped: 0 };

    const ctx = (() => {
      try { return Context.current(); } catch { return undefined; }
    })();
    const heartbeatInterval = ctx
      ? setInterval(() => { try { ctx.heartbeat({ stamped: output.stamped, failed: output.failed }); } catch { /* not in activity */ } }, 2000)
      : undefined;

    try {
      const jobContext: JobManagerContext = await this.redisService.getJobManagerContext(jobRunId);
      const tPathId = jobContext.jobConfig?.destinationFileServer?.pathId;
      const destDirectoryPath = jobContext.jobConfig?.destinationDirectoryPath;

      if (!tPathId) {
        this.logger.warn(`[${jobRunId}] No destination pathId on job config — skipping directory restamp pass.`);
        return output;
      }

      const baseTargetPrefixPath = basePrefix(jobRunId, tPathId, destDirectoryPath);
      const initialCount = await this.deferredDirStampService.count(jobRunId).catch(() => 0);
      this.logger.log(`[${jobRunId}] Starting deferred directory restamp pass: ${initialCount} entries (batch size ${batchSize}).`);

      while (true) {
        const batch = await this.deferredDirStampService.popBatch(jobRunId, batchSize);
        if (!batch || batch.length === 0) break;

        // Stamp within a batch in parallel — each utimes is independent.
        const results = await Promise.allSettled(batch.map(rec => this.applyStamp(baseTargetPrefixPath, rec, jobRunId)));
        for (const r of results) {
          output.attempted += 1;
          if (r.status === "fulfilled") {
            if (r.value === "stamped") output.stamped += 1;
            else if (r.value === "skipped") output.skipped += 1;
          } else {
            output.failed += 1;
          }
        }
      }

      this.logger.log(
        `[${jobRunId}] Directory restamp pass complete — attempted=${output.attempted}, stamped=${output.stamped}, skipped=${output.skipped}, failed=${output.failed}.`,
      );
      return output;
    } catch (error) {
      // Restamping is a best-effort post-pass: if it fails wholesale the
      // migration is still considered successful. Log and surface counts.
      this.logger.error(
        `[${jobRunId}] Directory restamp pass aborted: ${error?.message ?? error}`,
        error?.stack,
      );
      return output;
    } finally {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      // Guaranteed cleanup so that an aborted pass doesn't leak the ZSET/
      // meta-hash for the lifetime of the Redis instance. The cleanup is
      // best-effort (its own try/catch) and idempotent.
      await this.deferredDirStampService.cleanup(jobRunId);
    }
  }

  private async applyStamp(baseTargetPrefixPath: string, rec: DeferredDirStamp, jobRunId: string): Promise<"stamped" | "skipped"> {
    if (!rec?.fPath || !rec?.atime || !rec?.mtime) return "skipped";

    // path.join handles separator normalization across platforms and trims
    // duplicate slashes that arise from the relative `fPath` already
    // beginning with '/'.
    const targetPath = path.join(baseTargetPrefixPath, rec.fPath);
    const atime = new Date(rec.atime);
    const mtime = new Date(rec.mtime);
    if (Number.isNaN(atime.getTime()) || Number.isNaN(mtime.getTime())) {
      this.logger.warn(`[${jobRunId}] Skipping restamp for ${rec.fPath}: invalid timestamps (${rec.atime}, ${rec.mtime}).`);
      return "skipped";
    }

    try {
      await fs.promises.utimes(targetPath, atime, mtime);
      return "stamped";
    } catch (error) {
      // Common reasons: dir was never created (its COPY_DIR failed earlier),
      // or it was deleted between scan and restamp. Treat as skipped so the
      // restamp pass doesn't surface phantom failure counts; surface real
      // I/O errors as failures so they're observable.
      if (error?.code === "ENOENT") {
        this.logger.debug(`[${jobRunId}] Restamp skipped — target missing: ${targetPath}`);
        return "skipped";
      }
      this.logger.warn(`[${jobRunId}] Restamp failed for ${targetPath}: ${error?.message ?? error}`);
      throw error;
    }
  }
}
