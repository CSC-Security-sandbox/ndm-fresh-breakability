import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ErrorType, JobManagerContext } from "@netapp-cloud-datamigrate/jobs-lib";
import { LoggerFactory, LoggerService } from "@netapp-cloud-datamigrate/logger-lib";
import { Context } from "@temporalio/activity";
import * as fs from "fs";
import * as path from "path";
import { basePrefix, dmError } from "src/activities/utils/utils";
import { Operation, Origin } from "src/activities/utils/utils.types";
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

        const results = await Promise.allSettled(
          batch.map(rec => this.applyStamp(baseTargetPrefixPath, rec, jobRunId, jobContext)),
        );
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
      this.logger.error(
        `[${jobRunId}] Directory restamp pass failed: ${error?.message ?? error}`,
        error?.stack,
      );
      throw error;
    } finally {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      // Guaranteed cleanup so that an aborted pass doesn't leak the ZSET/
      // meta-hash for the lifetime of the Redis instance. The cleanup is
      // best-effort (its own try/catch) and idempotent.
      await this.deferredDirStampService.cleanup(jobRunId);
    }
  }

  private async applyStamp(
    baseTargetPrefixPath: string,
    rec: DeferredDirStamp,
    jobRunId: string,
    jobContext: JobManagerContext,
  ): Promise<"stamped" | "skipped"> {
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

    // Stamp mTime at destination. Retries locally (3 attempts with linear
    // backoff) since entries are already popped from Redis and cannot be
    // re-processed by a Temporal activity retry.
    const MAX_UTIMES_RETRIES = 2; // 0-indexed → 3 total attempts
    let lastUtimesError: any;
    for (let attempt = 0; attempt <= MAX_UTIMES_RETRIES; attempt++) {
      try {
        await fs.promises.utimes(targetPath, atime, mtime);
        lastUtimesError = null;
        break;
      } catch (error) {
        if (error?.code === "ENOENT") {
          this.logger.debug(`[${jobRunId}] Restamp skipped — target missing: ${targetPath}`);
          return "skipped";
        }
        lastUtimesError = error;
        if (attempt < MAX_UTIMES_RETRIES) {
          const delayMs = (attempt + 1) * 1000;
          this.logger.warn(
            `[${jobRunId}] utimes failed for ${targetPath} (attempt ${attempt + 1}/${MAX_UTIMES_RETRIES + 1}): ${error?.message} — retrying in ${delayMs}ms`,
          );
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }

    if (lastUtimesError) {
      this.logger.error(
        `[${jobRunId}] utimes failed for ${targetPath} after ${MAX_UTIMES_RETRIES + 1} attempts: ${lastUtimesError?.message}`,
      );
      const dmErr = dmError(
        "OPERATION", Origin.DESTINATION, Operation.STAMP_TIME,
        ErrorType.TRANSIENT_ERROR,
        // Deferred restamp pass has no originating command — correlation is
        // by path only. The dmError carries `errorFiles` so the path is still
        // recoverable downstream.
        "",
        lastUtimesError,
        { name: rec.fPath, path: targetPath },
      );
      await jobContext.publishToErrorStream(dmErr, jobContext.jobConfig?.jobRunId);
      throw lastUtimesError;
    }

    return "stamped";
  }
}
