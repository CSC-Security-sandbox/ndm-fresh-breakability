import { Inject, Injectable } from "@nestjs/common";
import { OPS_CMD, OPS_STATUS } from "@netapp-cloud-datamigrate/jobs-lib";
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import * as fs from "fs";
import { dmError } from "src/activities/utils/utils";
import { Operation, Origin } from "src/activities/utils/utils.types";
import { RedisService } from "src/redis/redis.service";
import { SourceAclError } from "./win-opeartions/acl-operation.error";
import { WinOperationService } from "./win-opeartions/win-operation.service";
import { CommandExecInput, CommandOutput } from "./command-execution.type";
import { StampMetaOutput } from "./stamp-meta.type";
import { MetricsService } from "src/metrics/metrics.service";
import { Timed } from "src/metrics/timed.decorator";


@Injectable()
export class StampMetaService {
    private readonly logger: LoggerService;
    constructor(
        private readonly redisService: RedisService,
        private readonly winOperationService: WinOperationService,
        private readonly metricsService: MetricsService,
        @Inject(LoggerFactory) loggerFactory: LoggerFactory,
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

            if (process.platform === 'win32') {

                // Stamp SID to object

                const [aclStampOutput, preserveTimeOutput] = await Promise.all([
                    this.stampObjectACL(input),
                    this.preserveAccessAndModifiedTime(input)
                ]);

                output.sourceErrors.push(...aclStampOutput.sourceErrors, ...preserveTimeOutput.sourceErrors);
                output.targetErrors.push(...aclStampOutput.targetErrors, ...preserveTimeOutput.targetErrors);
                
                if(aclStampOutput.targetErrors.length === 0 && aclStampOutput.sourceErrors.length ===0) {
                // Stamp access and modified time
                    const timeOutput = await this.stampAccessAndModifiedTime(input);
                    output.sourceErrors.push(...timeOutput.sourceErrors);
                    output.targetErrors.push(...timeOutput.targetErrors);
                }
            }
            else {

                // Step 1: chown (targetPath) and preserve source time (sourcePath) are independent — run in parallel
                const [gidUidOutput, preserveTimeOutput] = await Promise.all([
                    this.stampGIDandUID(input),
                    this.preserveAccessAndModifiedTime(input),
                ]);
                output.sourceErrors.push(...gidUidOutput.sourceErrors, ...preserveTimeOutput.sourceErrors);
                output.targetErrors.push(...gidUidOutput.targetErrors, ...preserveTimeOutput.targetErrors);

                // Step 2: chmod must run after chown (changing owner can reset setuid/setgid bits)
                const permissionsOutput = await this.stampPermission(input);
                output.sourceErrors.push(...permissionsOutput.sourceErrors);
                output.targetErrors.push(...permissionsOutput.targetErrors);

                // Step 3: utimes must run last so chmod does not overwrite atime/mtime
                const timeOutput = await this.stampAccessAndModifiedTime(input);
                output.sourceErrors.push(...timeOutput.sourceErrors);
                output.targetErrors.push(...timeOutput.targetErrors);
            }
        }

        // Only update status if the operation exists
        if (input.command.ops[OPS_CMD.STAMP_META]) {
            if (output.sourceErrors.length > 0 || output.targetErrors.length > 0)
                input.command.ops[OPS_CMD.STAMP_META].status = OPS_STATUS.ERROR;
            else
                input.command.ops[OPS_CMD.STAMP_META].status = OPS_STATUS.COMPLETED;
        }
        return output;
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
                await jobContext.publishToErrorStream(dmErr);
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
                await jobContext.publishToErrorStream(dmErr);
                output.targetErrors.push(error.code);
            }
        }
        return output;
    }

    @Timed({ category: 'stamp_phase', phase: 'stamp_time' })
    async stampAccessAndModifiedTime({ command, jobContext, targetPath, errorType }: CommandExecInput): Promise<StampMetaOutput> {
        const output: StampMetaOutput = { sourceErrors: [], targetErrors: [] };
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
                await jobContext.publishToErrorStream(dmErr);
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
                await jobContext.publishToErrorStream(dmErr);
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
                    await jobContext.publishToErrorStream(dmErr);
                    output.targetErrors.push(...stampAclOutput.errors);
                }
            } catch (error) {
                const origin = error instanceof SourceAclError ? Origin.SOURCE : Origin.DESTINATION;
                this.logger.error(`Stamping ACL from ${sourcePath} to ${targetPath}, Error: ${error.message}`, error.stack);
                const dmErr = dmError("OPERATION", origin, Operation.STAMP_META, errorType, command.id, error, { name: command.fPath, path: targetPath });
                await jobContext.publishToErrorStream(dmErr);
                output.sourceErrors.push(error.code);
            }
        }
        return output;
    }

    async resetFileAttributes(path: string): Promise<boolean> {
        return this.winOperationService.resetFileAttributes(path);
    }

}

