import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OPS_CMD, OPS_STATUS, ErrorType } from "@netapp-cloud-datamigrate/jobs-lib";
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import * as fs from "fs";
import * as path from "path";
import { CtimeTestTriggersService } from "../ctime-test-triggers.service";
import { dmError } from "src/activities/utils/utils";
import { Operation, Origin } from "src/activities/utils/utils.types";
import { RedisService } from "src/redis/redis.service";
import { SourceAclError } from "./win-opeartions/acl-operation.error";
import { WinOperationService } from "./win-opeartions/win-operation.service";
import { CommandExecInput, CommandOutput } from "./command-execution.type";
import { StampMetaOutput } from "./stamp-meta.type";
import { MetricsService } from "src/metrics/metrics.service";
import { Timed } from "src/metrics/timed.decorator";
import { DeferredDirStampService } from "../../shared/deferred-dir-stamp.service";

const MAX_CTIME_RETRIES = 2;


@Injectable()
export class StampMetaService {
    private readonly logger: LoggerService;

    constructor(
        private readonly redisService: RedisService,
        private readonly winOperationService: WinOperationService,
        private readonly metricsService: MetricsService,
        private readonly deferredDirStampService: DeferredDirStampService,
        private readonly ctimeTestTriggers: CtimeTestTriggersService,
        @Inject(LoggerFactory) loggerFactory: LoggerFactory,
        @Inject(ConfigService) configService: ConfigService,
    ) {
        this.logger = loggerFactory.create(StampMetaService.name);
    }

    @Timed(MetricsService.METRIC.STAMP_META)
    async stampMetaData(input: CommandExecInput): Promise<CommandOutput> {
        const output: CommandOutput = { shouldStampMeta: false, sourceErrors: [], targetErrors: [], shouldUpdateItemInfo: true };

        if (
            input.command.ops[OPS_CMD.STAMP_META] &&
            input.command.ops[OPS_CMD.STAMP_META].status !== OPS_STATUS.COMPLETED
        ) {
            const shouldValidateCtime = process.platform === 'win32';

            if (shouldValidateCtime) {
                await this.stampMetaWithCtimeValidation(input, output);
            } else {
                await this.executeStampMeta(input, output);
            }
        }

        if (input.command.ops[OPS_CMD.STAMP_META]) {
            if (output.sourceErrors.length > 0 || output.targetErrors.length > 0)
                input.command.ops[OPS_CMD.STAMP_META].status = OPS_STATUS.ERROR;
            else
                input.command.ops[OPS_CMD.STAMP_META].status = OPS_STATUS.COMPLETED;
        }
        return output;
    }

    /**
     * Wraps the stamp operations with ctime-based validation per the design.
     * The flow uses 3 ctime checkpoints to bracket our own
     * source-modifying operation (preserveAccessAndModifiedTime) separately
     * from external changes:
     *
     *   T1:    fetch source cTime before any operations
     *   (stamp permissions/ACL at destination)
     *   (preserveAccessAndModifiedTime — bumps source cTime)
     *   T2End: fetch source cTime after restoring aTime/mTime at source
     *   (stamp aTime/mTime at destination)
     *   T3:    fetch source cTime after all operations
     *
     *   CHECK: T3 > T2End (files with preserveAccessTime)
     *          T3 > T1    (dirs / no preserveAccessTime)
     *
     * When preserveAccessTime is disabled, preserveAccessAndModifiedTime is
     * a no-op so T2End is skipped and we fall back to a simple
     * T1 vs T3 comparison.
     */
    private async stampMetaWithCtimeValidation(input: CommandExecInput, output: CommandOutput): Promise<void> {
        const preserveAccessTime = !!input.jobContext.jobConfig?.options?.preserveAccessTime;
        const cmdId = input.command.id;

        this.logger.log(
            `[${cmdId}] CtimeValidation START | preserveAccessTime=${preserveAccessTime} `
            + `| sourcePath=${input.sourcePath} | fPath=${input.command.fPath}`,
        );

        for (let attempt = 0; attempt <= MAX_CTIME_RETRIES; attempt++) {
            // Step 1 (T1): fetch source cTime before any operations
            const ctimeT1 = await this.fetchSourceCtimeMs(input.sourcePath);
            this.logger.log(
                `[${cmdId}] [attempt=${attempt + 1}/${MAX_CTIME_RETRIES + 1}] T1=${ctimeT1} `
                + `(${new Date(ctimeT1).toISOString()}) | ${input.sourcePath}`,
            );

            const attemptOutput: CommandOutput = { shouldStampMeta: false, sourceErrors: [], targetErrors: [], shouldUpdateItemInfo: true };

            // Step 2: stamp ACL at destination (doesn't bump source ctime)
            // Step 3: preserve aTime/mTime at source in parallel (bumps source ctime), then capture T2End
            let ctimeT2End: number = 0;
            const aclStampPromise = this.stampObjectACL(input);
            const preserveTimePromise = preserveAccessTime
                ? this.preserveAccessAndModifiedTimeAndCaptureT2End(input, cmdId)
                : Promise.resolve(null);

            const [aclStampOutput, preserveTimeResult] = await Promise.all([aclStampPromise, preserveTimePromise]);
            attemptOutput.sourceErrors.push(...aclStampOutput.sourceErrors);
            attemptOutput.targetErrors.push(...aclStampOutput.targetErrors);
            if (preserveTimeResult) {
                ctimeT2End = preserveTimeResult.ctimeT2End;
                attemptOutput.sourceErrors.push(...preserveTimeResult.output.sourceErrors);
            }

            this.logger.log(
                `[${cmdId}] ACL stamp done | sourceErrors=${aclStampOutput.sourceErrors.length} `
                + `| targetErrors=${aclStampOutput.targetErrors.length}`,
            );

            const noAclErrors = aclStampOutput.sourceErrors.length === 0 && aclStampOutput.targetErrors.length === 0;
            if (noAclErrors) {
                const timeOutput = await this.stampAccessAndModifiedTime(input);
                attemptOutput.sourceErrors.push(...timeOutput.sourceErrors);
                attemptOutput.targetErrors.push(...timeOutput.targetErrors);
            }

            this.ctimeTestTriggers.testExhaustAllRetries(input.sourcePath, attempt + 1, cmdId);
            this.ctimeTestTriggers.testChangeBetweenT2EndAndT3(input.sourcePath, attempt + 1, cmdId);

            // Step 4 (T3): fetch source cTime after all operations
            const ctimeT3 = await this.fetchSourceCtimeMs(input.sourcePath);
            this.logger.log(
                `[${cmdId}] T3=${ctimeT3} (${new Date(ctimeT3).toISOString()}) | `
                + `T1=${ctimeT1}, T2End=${ctimeT2End}`,
            );

            // CHECK: T3 > T2End (files with preserveAccessTime) or T3 > T1 (dirs / no preserveAccessTime)
            let sourceChanged: boolean;
            if (preserveAccessTime) {
                sourceChanged = ctimeT3 > ctimeT2End;
                this.logger.log(
                    `[${cmdId}] preserveAccessTime check | T3 > T2End = ${sourceChanged}`,
                );
            } else {
                sourceChanged = ctimeT3 > ctimeT1;
                this.logger.log(
                    `[${cmdId}] simple check | T3 > T1 = ${sourceChanged}`,
                );
            }

            if (!sourceChanged) {
                this.logger.log(
                    `[${cmdId}] CtimeValidation PASSED | postStampCtime=${new Date(ctimeT3).toISOString()} `
                    + `| attempt=${attempt + 1}/${MAX_CTIME_RETRIES + 1}`,
                );
                output.sourceErrors.push(...attemptOutput.sourceErrors);
                output.targetErrors.push(...attemptOutput.targetErrors);
                output.postStampSourceCtimeIso = new Date(ctimeT3).toISOString();
                if (input.command.isDir) {
                    await this.deferredDirStampService.updateSourceCtime(
                        input.jobContext.jobRunId, input.command.fPath, output.postStampSourceCtimeIso,
                    );
                }
                return;
            }

            this.logger.warn(
                `[${cmdId}] Source ctime changed during stamp `
                + `(T1=${ctimeT1}, T2End=${ctimeT2End}, T3=${ctimeT3}, `
                + `attempt=${attempt + 1}/${MAX_CTIME_RETRIES + 1}): ${input.sourcePath}`,
            );

            if (attempt === MAX_CTIME_RETRIES) {
                this.logger.error(
                    `[${cmdId}] CtimeValidation FAILED | all ${MAX_CTIME_RETRIES + 1} attempts exhausted `
                    + `| publishing PERM_STAMP_CTIME_CONFLICT | ${input.sourcePath}`,
                );
                output.sourceErrors.push(...attemptOutput.sourceErrors);
                output.targetErrors.push(...attemptOutput.targetErrors);
                output.postStampSourceCtimeIso = new Date(ctimeT3).toISOString();
                if (input.command.isDir) {
                    await this.deferredDirStampService.updateSourceCtime(
                        input.jobContext.jobRunId, input.command.fPath, output.postStampSourceCtimeIso,
                    );
                }
                const error = new Error(
                    `Source metadata changed during all ${MAX_CTIME_RETRIES + 1} stamp attempts. `
                    + `Re-run migration after source stabilizes.`,
                );
                const dmErr = dmError(
                    "OPERATION", Origin.SOURCE, Operation.STAMP_META,
                    'PERM_STAMP_CTIME_CONFLICT' as ErrorType,
                    input.command.id, error,
                    { name: input.command.fPath, path: input.sourcePath },
                );
                await input.jobContext.publishToErrorStream(dmErr, input.jobContext.jobConfig?.jobRunId);
                output.sourceErrors.push('PERM_STAMP_CTIME_CONFLICT');
            }
        }
    }

    private async fetchSourceCtimeMs(sourcePath: string): Promise<number> {
        const stat = await fs.promises.lstat(sourcePath);
        return Math.floor(stat.ctimeMs);
    }

    private async executeStampMeta(input: CommandExecInput, output: CommandOutput): Promise<void> {
        if (process.platform === 'win32') {
            const [aclStampOutput, preserveTimeOutput] = await Promise.all([
                this.stampObjectACL(input),
                this.preserveAccessAndModifiedTime(input)
            ]);

            output.sourceErrors.push(...aclStampOutput.sourceErrors, ...preserveTimeOutput.sourceErrors);
            output.targetErrors.push(...aclStampOutput.targetErrors, ...preserveTimeOutput.targetErrors);

            if(aclStampOutput.targetErrors.length === 0 && aclStampOutput.sourceErrors.length === 0) {
                const timeOutput = await this.stampAccessAndModifiedTime(input);
                output.sourceErrors.push(...timeOutput.sourceErrors);
                output.targetErrors.push(...timeOutput.targetErrors);
            }
        } else {
            const [gidUidOutput, preserveTimeOutput] = await Promise.all([
                this.stampGIDandUID(input),
                this.preserveAccessAndModifiedTime(input),
            ]);
            output.sourceErrors.push(...gidUidOutput.sourceErrors, ...preserveTimeOutput.sourceErrors);
            output.targetErrors.push(...gidUidOutput.targetErrors, ...preserveTimeOutput.targetErrors);

            const permissionsOutput = await this.stampPermission(input);
            output.sourceErrors.push(...permissionsOutput.sourceErrors);
            output.targetErrors.push(...permissionsOutput.targetErrors);

            const timeOutput = await this.stampAccessAndModifiedTime(input);
            output.sourceErrors.push(...timeOutput.sourceErrors);
            output.targetErrors.push(...timeOutput.targetErrors);
        }
    }

    @Timed({ category: 'stamp_phase', phase: 'permissions' })
    async stampPermission({ command, jobContext, sourcePath, targetPath, errorType }: CommandExecInput): Promise<StampMetaOutput> {
        const output: StampMetaOutput = { sourceErrors: [], targetErrors: [] };
        if (command.metadata?.mode && !command?.metadata?.isSymLink && jobContext.jobConfig.options.preservePermissions) {
            try {
                await fs.promises.chmod(targetPath, command.metadata.mode);
            } catch (error) {
                this.logger.error(`Stamping Permission from ${sourcePath} to ${targetPath}, Error: ${error.message}`, error.stack);
                const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, errorType, command.id, error, { name: command.fPath, path: targetPath });
                await jobContext.publishToErrorStream(dmErr, jobContext.jobConfig?.jobRunId);
                output.targetErrors.push(error.code);
            }
        }
        return output;
    }


    @Timed({ category: 'stamp_phase', phase: 'gid_uid' })
    async stampGIDandUID({ command, jobContext, sourcePath, targetPath, errorType }: CommandExecInput): Promise<StampMetaOutput> {
        const output: StampMetaOutput = { sourceErrors: [], targetErrors: [] };
        if (command.metadata?.gid && command.metadata?.uid && process.platform !== 'win32' && jobContext.jobConfig.options.preservePermissions) {
            try {
                let gid = command.metadata.gid?.toString();
                let uid = command.metadata.uid?.toString();
                if (jobContext.jobConfig.options.isIdentityMappingAvailable) {
                    let [gid_res, uid_res] = await Promise.all([
                        this.redisService.getOwnerIdentity(jobContext.jobRunId, command.metadata.gid?.toString(), 'GID'),
                        this.redisService.getOwnerIdentity(jobContext.jobRunId, command.metadata.uid?.toString(), 'UID'),
                    ]);
                    gid = gid_res;
                    uid = uid_res;
                }
                if (gid && uid) {
                    if (command?.metadata?.isSymLink) {
                        await fs.promises.lchown(targetPath, parseInt(uid), parseInt(gid));
                    } else {
                        await fs.promises.chown(targetPath, parseInt(uid), parseInt(gid));
                    }
                }
            } catch (error) {
                this.logger.error(`Stamping GID and UID from ${sourcePath} to ${targetPath}, Error: ${error.message}`, error.stack);
                const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, errorType, command.id, error, { name: command.fPath, path: targetPath });
                await jobContext.publishToErrorStream(dmErr, jobContext.jobConfig?.jobRunId);
                output.targetErrors.push(error.code);
            }
        }
        return output;
    }

    @Timed({ category: 'stamp_phase', phase: 'stamp_time' })
    async stampAccessAndModifiedTime({ command, jobContext, targetPath, errorType }: CommandExecInput): Promise<StampMetaOutput> {
        const output: StampMetaOutput = { sourceErrors: [], targetErrors: [] };
        // Skip per-command mtime/atime stamping for directories: any subsequent
        // child write will clobber it. Directories are restamped in a single
        // post-migration pass driven by DeferredDirStampService.
        if (command.isDir) {
            return output;
        }
        if (command.metadata.mtime && command.metadata.atime) {
            try {
                if (command?.metadata?.isSymLink) {
                    await fs.promises.lutimes(targetPath, new Date(command.metadata.atime), new Date(command.metadata.mtime));
                } else {
                    await fs.promises.utimes(targetPath, new Date(command.metadata.atime), new Date(command.metadata.mtime));
                }
            } catch (error) {
                this.logger.error(`Stamping Access and Modified Time  to ${targetPath}, Error: ${error.message}`, error.stack);
                const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_TIME, errorType, command.id, error, { name: command.fPath, path: targetPath });
                await jobContext.publishToErrorStream(dmErr, jobContext.jobConfig?.jobRunId);
                output.targetErrors.push(error.code);
            }
        }
        return output;
    }

    @Timed({ category: 'stamp_phase', phase: 'preserve_time' })
    async preserveAccessAndModifiedTime({ command, jobContext, sourcePath, targetPath, errorType }: CommandExecInput): Promise<StampMetaOutput> {
        const output: StampMetaOutput = { sourceErrors: [], targetErrors: [] };
        if (command.metadata.mtime && command.metadata.atime && jobContext.jobConfig.options.preserveAccessTime) {
            try {
                if (command?.metadata?.isSymLink) {
                    await fs.promises.lutimes(sourcePath, new Date(command.metadata.atime), new Date(command.metadata.mtime));
                } else {
                    await fs.promises.utimes(sourcePath, new Date(command.metadata.atime), new Date(command.metadata.mtime));
                }
            } catch (error) {
                this.logger.error(`Preserve Access and Modified Time  to ${sourcePath}, Error: ${error.message}`, error.stack);
                const dmErr = dmError("OPERATION", Origin.SOURCE, Operation.STAMP_TIME, errorType, command.id, error, { name: command.fPath, path: targetPath });
                await jobContext.publishToErrorStream(dmErr, jobContext.jobConfig?.jobRunId);
                output.sourceErrors.push(error.code);
            }
        }
        return output;
    }

    @Timed({ category: 'stamp_phase', phase: 'acl' })
    async stampObjectACL({ command, jobContext, sourcePath, targetPath, errorType }: CommandExecInput): Promise<StampMetaOutput> {
        const output: StampMetaOutput = { sourceErrors: [], targetErrors: [] };
        if (jobContext.jobConfig.options.preservePermissions) {
            try {
                this.logger.debug(`Stamping ACL from ${sourcePath} to ${targetPath}`);
                const stampAclOutput = await this.winOperationService.stampAclOperation({ command, jobContext, sourcePath, targetPath, errorType });
                if (stampAclOutput.errors && stampAclOutput.errors.length > 0) {
                    const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, errorType, command.id, new Error(stampAclOutput.errors.join(",\n")), { name: command.fPath, path: targetPath });
                    await jobContext.publishToErrorStream(dmErr, jobContext.jobConfig?.jobRunId);
                    output.targetErrors.push(...stampAclOutput.errors);
                }
            } catch (error) {
                const origin = error instanceof SourceAclError ? Origin.SOURCE : Origin.DESTINATION;
                this.logger.error(`Stamping ACL from ${sourcePath} to ${targetPath}, Error: ${error.message}`, error.stack);
                const dmErr = dmError("OPERATION", origin, Operation.STAMP_META, errorType, command.id, error, { name: command.fPath, path: targetPath });
                await jobContext.publishToErrorStream(dmErr, jobContext.jobConfig?.jobRunId);
                output.sourceErrors.push(error.code);
            }
        }
        return output;
    }

    private async preserveAccessAndModifiedTimeAndCaptureT2End(
        input: CommandExecInput,
        cmdId: string,
    ): Promise<{ output: StampMetaOutput; ctimeT2End: number }> {
        const output = await this.preserveAccessAndModifiedTime(input);
        const ctimeT2End = await this.fetchSourceCtimeMs(input.sourcePath);
        this.logger.log(`[${cmdId}] T2End=${ctimeT2End} (${new Date(ctimeT2End).toISOString()})`);
        return { output, ctimeT2End };
    }

    async resetFileAttributes(path: string): Promise<boolean> {
        return this.winOperationService.resetFileAttributes(path);
    }

}

