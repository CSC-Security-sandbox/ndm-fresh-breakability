import { Inject, Injectable } from "@nestjs/common";
import { OPS_CMD, OPS_STATUS } from "@netapp-cloud-datamigrate/jobs-lib";
import { LoggerFactory, LoggerService } from "@netapp-cloud-datamigrate/logger-lib";
import * as fs from "fs";
import { dmError } from "src/activities/utils/utils";
import { Operation, Origin } from "src/activities/utils/utils.types";
import { CommandExecInput, CommandOutput } from "./command-execution.type";
import { StampMetaOutput } from "./stamp-meta.type";
import { StampMetaService } from "./stamp-meta.service";
import { MetricsService } from "src/metrics/metrics.service";
import { Timed } from "src/metrics/timed.decorator";

/**
 * Executes an atime-only restamp on the destination. Emitted by the migrate-scan
 * 3rd branch when content and metadata already match but `atimeMs` drifts between
 * source and destination on a non-discovery job.
 *
 * Distinct from `StampMetaService`: this op MUST NOT touch chmod, chown, lchown,
 * or ACL. It performs a defensive `lstat` of the destination first and skips the
 * `utimes`/`lutimes` syscall when the destination is already aligned with
 * `command.metadata.atime`.
 *
 * When `preserveAccessTime` is enabled, source preservation runs in parallel via
 * `StampMetaService.preserveAccessAndModifiedTime` so behavior stays consistent
 * with the existing stamp pipeline.
 */
@Injectable()
export class StampAtimeService {
    private readonly logger: LoggerService;

    constructor(
        private readonly stampMetaService: StampMetaService,
        private readonly metricsService: MetricsService,
        @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    ) {
        this.logger = loggerFactory.create(StampAtimeService.name);
    }

    @Timed(MetricsService.METRIC.STAMP_ATIME)
    async stampAtime(input: CommandExecInput): Promise<CommandOutput> {
        const output: CommandOutput = { shouldStampMeta: false, sourceErrors: [], targetErrors: [], shouldUpdateItemInfo: true };

        const op = input.command.ops?.[OPS_CMD.STAMP_ATIME];
        if (!op || op.status === OPS_STATUS.COMPLETED) {
            return output;
        }

        if (!input.command.metadata?.atime || !input.command.metadata?.mtime) {
            input.command.ops[OPS_CMD.STAMP_ATIME].status = OPS_STATUS.COMPLETED;
            return output;
        }

        // Run destination atime stamp and (optionally) source preservation in parallel.
        const [destOutput, preserveOutput] = await Promise.all([
            this.applyAtimeToDestination(input),
            this.stampMetaService.preserveAccessAndModifiedTime(input),
        ]);
        output.sourceErrors.push(...destOutput.sourceErrors, ...preserveOutput.sourceErrors);
        output.targetErrors.push(...destOutput.targetErrors, ...preserveOutput.targetErrors);

        if (output.sourceErrors.length > 0 || output.targetErrors.length > 0) {
            input.command.ops[OPS_CMD.STAMP_ATIME].status = OPS_STATUS.ERROR;
        } else {
            input.command.ops[OPS_CMD.STAMP_ATIME].status = OPS_STATUS.COMPLETED;
        }
        return output;
    }

    /**
     * Defensive re-check + single `utimes`/`lutimes` call on the destination.
     * Skips the syscall when destination `atimeMs` already equals
     * `command.metadata.atime`, which avoids redundant SMB/NFS round-trips on
     * retries and tolerates scan-to-execute staleness.
     */
    @Timed({ category: 'stamp_phase', phase: 'atime_only' })
    async applyAtimeToDestination({ command, jobContext, targetPath, errorType }: CommandExecInput): Promise<StampMetaOutput> {
        const output: StampMetaOutput = { sourceErrors: [], targetErrors: [] };
        const atime = new Date(command.metadata.atime);
        const mtime = new Date(command.metadata.mtime);

        try {
            const destStat = await fs.promises.lstat(targetPath);
            if (destStat.atimeMs === atime.getTime()) {
                this.logger.debug(`STAMP_ATIME skipped: destination already aligned at ${targetPath}`);
                return output;
            }
        } catch (error) {
            this.logger.error(`STAMP_ATIME pre-check lstat failed for ${targetPath}: ${error.message}`, error.stack);
            const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_TIME, errorType, command.id, error, { name: command.fPath, path: targetPath });
            await jobContext.publishToErrorStream(dmErr, jobContext.jobConfig?.jobRunId);
            output.targetErrors.push(error.code);
            return output;
        }

        try {
            if (command.metadata.isSymLink) {
                await fs.promises.lutimes(targetPath, atime, mtime);
            } else {
                await fs.promises.utimes(targetPath, atime, mtime);
            }
        } catch (error) {
            this.logger.error(`Stamping Access Time to ${targetPath}, Error: ${error.message}`, error.stack);
            const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_TIME, errorType, command.id, error, { name: command.fPath, path: targetPath });
            await jobContext.publishToErrorStream(dmErr, jobContext.jobConfig?.jobRunId);
            output.targetErrors.push(error.code);
        }
        return output;
    }
}
