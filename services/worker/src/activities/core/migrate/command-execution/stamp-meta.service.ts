import { Inject, Injectable } from "@nestjs/common";
import { OPS_CMD, OPS_STATUS } from "@netapp-cloud-datamigrate/jobs-lib";
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import * as fs from "fs";
import { ShellService } from "src/activities/common/shell.service";
import { dmError } from "src/activities/utils/utils";
import { Operation, Origin } from "src/activities/utils/utils.types";
import { RedisService } from "src/redis/redis.service";
import { CommandExecInput, CommandOutput } from "./command-execution.type";
import { getAclScript, getTransferAclSript, validateSidMapping } from "./sid-mapping.util";
import { AclEntry } from "./sid-mapping.util.type";
import { StampMetaOutput } from "./stamp-meta.type";


import {
    ACLOperations,

    stampFileACL,
    compareFileACLs,


    ACLError,
    FileAccessError,
    CommandExecutionError,
    type ComparisonResult,
    type ACLData,
    type StampResult,

} from './aclOperations';
import { error } from "console";

@Injectable()
export class StampMetaService {
    private readonly logger: LoggerService;
    private readonly attributeRegex = /^([A-Za-z]:[\\/]|[\\/])/;
    constructor(
        private readonly shellService: ShellService,
        private readonly redisService: RedisService,
        @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    ) {
        this.logger = loggerFactory.create(StampMetaService.name);
    }

    async stampMetaData(input: CommandExecInput): Promise<CommandOutput> {
        const output: CommandOutput = { shouldStampMeta: false, sourceErrors: [], targetErrors: [] };

        if (
            input.command.ops[OPS_CMD.STAMP_META] &&
            input.command.ops[OPS_CMD.STAMP_META].status !== OPS_STATUS.COMPLETED
        ) {

            if (process.platform === 'win32') {
                // Stamp SID to object
                const sidOutput = await this.stampSIDAclToObject(input);
                output.sourceErrors.push(...sidOutput.sourceErrors);
                output.targetErrors.push(...sidOutput.targetErrors);

                // Stamp Hidden Metadata
                const hiddenAttrOutput = await this.stampFileAttrMeta(input);
                output.sourceErrors.push(...hiddenAttrOutput.sourceErrors);
                output.targetErrors.push(...hiddenAttrOutput.targetErrors);

                // Preserve access and modified time
                const preserveTimeOutput = await this.preserveAccessAndModifiedTime(input);
                output.sourceErrors.push(...preserveTimeOutput.sourceErrors);
                output.targetErrors.push(...preserveTimeOutput.targetErrors);

                // Stamp access and modified time
                const timeOutput = await this.stampAccessAndModifiedTime(input);
                output.sourceErrors.push(...timeOutput.sourceErrors);
                output.targetErrors.push(...timeOutput.targetErrors);

                // Stamp permissions
                const permissionsOutput = await this.stampPermission(input);
                output.sourceErrors.push(...permissionsOutput.sourceErrors);
                output.targetErrors.push(...permissionsOutput.targetErrors);
            }
            else {
                // Stamp GID and UID
                const gidUidOutput = await this.stampGIDandUID(input);
                output.sourceErrors.push(...gidUidOutput.sourceErrors);
                output.targetErrors.push(...gidUidOutput.targetErrors);

                // Preserve access and modified time
                const preserveTimeOutput = await this.preserveAccessAndModifiedTime(input);
                output.sourceErrors.push(...preserveTimeOutput.sourceErrors);
                output.targetErrors.push(...preserveTimeOutput.targetErrors);

                // Stamp access and modified time
                const timeOutput = await this.stampAccessAndModifiedTime(input);
                output.sourceErrors.push(...timeOutput.sourceErrors);
                output.targetErrors.push(...timeOutput.targetErrors);

                // Stamp permissions
                const permissionsOutput = await this.stampPermission(input);
                output.sourceErrors.push(...permissionsOutput.sourceErrors);
                output.targetErrors.push(...permissionsOutput.targetErrors);
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

    async stampPermission({ command, jobContext, sourcePath, targetPath, errorType }: CommandExecInput): Promise<StampMetaOutput> {
        const output: StampMetaOutput = { sourceErrors: [], targetErrors: [] };
        if (command.metadata?.mode) {
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


    async stampGIDandUID({ command, jobContext, sourcePath, targetPath, errorType }: CommandExecInput): Promise<StampMetaOutput> {
        const output: StampMetaOutput = { sourceErrors: [], targetErrors: [] };
        if (command.metadata?.gid && command.metadata?.uid && process.platform !== 'win32') {
            try {
                let gid = command.metadata.gid?.toString();
                let uid = command.metadata.uid?.toString();
                if (jobContext.jobConfig.options.isIdentityMappingAvailable) {
                    gid = await this.redisService.getOwnerIdentity(jobContext.jobRunId, command.metadata.gid?.toString(), 'GID')
                    uid = await this.redisService.getOwnerIdentity(jobContext.jobRunId, command.metadata.uid?.toString(), 'UID')
                }
                if (gid && uid)
                    await fs.promises.chown(targetPath, parseInt(uid), parseInt(gid));
            } catch (error) {
                this.logger.error(`Stamping GID and UID from ${sourcePath} to ${targetPath}, Error: ${error.message}`, error.stack);
                const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, errorType, command.id, error, { name: command.fPath, path: targetPath });
                await jobContext.publishToErrorStream(dmErr);
                output.targetErrors.push(error.code);
            }
        }
        return output;
    }

    async stampAccessAndModifiedTime({ command, jobContext, targetPath, errorType }: CommandExecInput): Promise<StampMetaOutput> {
        const output: StampMetaOutput = { sourceErrors: [], targetErrors: [] };
        if (command.metadata.mtime && command.metadata.atime) {
            try {
                await fs.promises.utimes(targetPath, new Date(command.metadata.atime), new Date(command.metadata.mtime));
            } catch (error) {
                this.logger.error(`Stamping Access and Modified Time  to ${targetPath}, Error: ${error.message}`, error.stack);
                const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_TIME, errorType, command.id, error, { name: command.fPath, path: targetPath });
                await jobContext.publishToErrorStream(dmErr);
                output.targetErrors.push(error.code);
            }
        }
        return output;
    }

    async preserveAccessAndModifiedTime({ command, jobContext, sourcePath, targetPath, errorType }: CommandExecInput): Promise<StampMetaOutput> {
        const output: StampMetaOutput = { sourceErrors: [], targetErrors: [] };
        if (command.metadata.mtime && command.metadata.atime && jobContext.jobConfig.options.preserveAccessTime) {
            try {
                await fs.promises.utimes(sourcePath, new Date(command.metadata.atime), new Date(command.metadata.mtime));
            } catch (error) {
                this.logger.error(`Preserve Access and Modified Time  to ${sourcePath}, Error: ${error.message}`, error.stack);
                const dmErr = dmError("OPERATION", Origin.SOURCE, Operation.STAMP_TIME, errorType, command.id, error, { name: command.fPath, path: targetPath });
                await jobContext.publishToErrorStream(dmErr);
                output.sourceErrors.push(error.code);
            }
        }
        return output;
    }

    async stampSIDAclToObject({ command, jobContext, sourcePath, targetPath, errorType }: CommandExecInput): Promise<StampMetaOutput> {
        const output: StampMetaOutput = { sourceErrors: [], targetErrors: [] };
        if (process.platform !== 'win32') return output;

        const logData: string[] = [];

        try {
            // Verify both files exist before attempting ACL operations
            try {
                await Promise.all([
                    fs.promises.access(sourcePath, fs.constants.F_OK),
                    fs.promises.access(targetPath, fs.constants.F_OK)
                ]);
            } catch (accessError) {
                const missingFile = await fs.promises.access(sourcePath, fs.constants.F_OK)
                    .then(() => targetPath, () => sourcePath);

                logData.push(`File not accessible for ACL stamping: ${missingFile}`);
                const dmErr = dmError("OPERATION",
                    missingFile === sourcePath ? Origin.SOURCE : Origin.DESTINATION,
                    Operation.STAMP_META,
                    errorType,
                    command.id,
                    accessError,
                    { name: command.fPath, path: missingFile }
                );
                await jobContext.publishToErrorStream(dmErr);
                if (missingFile === sourcePath) {
                    output.sourceErrors.push('FILE_NOT_FOUND');
                } else {
                    output.targetErrors.push('FILE_NOT_FOUND');
                }
                return output;
            }

            const aclOps = new ACLOperations(this.redisService);


            const stampData = await aclOps.stampFileACL(sourcePath, targetPath, {
                preserveExisting: false,
                excludePrincipals: [],
                includePrincipals: [],
                resolveSIDs: true,
                isIdentityMappingAvailable: jobContext.jobConfig.options.isIdentityMappingAvailable,
                jobID: jobContext.jobRunId
            });

            // Process results
            let grantCount = 0;
            let denyCount = 0;
            let skipCount = 0;
            let failCount = 0;

            stampData.operations.forEach(op => {
                if (op.type === 'grant' && op.status === 'completed') {
                    grantCount++;
                    // logData.push(` Grant: ${op.principal} - ${op.permissions}`);
                } else if (op.type === 'deny' && op.status === 'completed') {
                    denyCount++;
                    // logData.push(`Deny: ${op.principal} - ${op.permissions}`);
                } else if (op.type === 'skip') {
                    skipCount++;
                    // logData.push(`⏭️  Skip: ${op.principal} (${op.reason})`);
                } else if (op.type === 'reset' && op.status === 'completed') {
                    // logData.push(`🔄 Reset: Clear existing permissions`);
                } else if (op.status === 'failed') {
                    failCount++;
                    logData.push(`Failed: ${op.type} ${op.principal} - ${op.error}`);
                    const failedIndex = stampData.operations.indexOf(op);
                    if (failedIndex >= 0 && failedIndex < stampData.commands.length) {
                        logData.push(`Failed command: ${stampData.commands[failedIndex]}`);
                    }
                }
            });

            // logData.push(`ACL Stamp Summary: ${grantCount} granted, ${denyCount} denied, ${skipCount} skipped, ${failCount} failed`);

            // Perform ACL comparison after stamping
            if (stampData.success || failCount < stampData.operations.length) {
                try {
                    await Promise.all([
                        fs.promises.access(sourcePath, fs.constants.F_OK),
                        fs.promises.access(targetPath, fs.constants.F_OK)
                    ]);

                    const comparisonResult = await aclOps.compareFileACLs(sourcePath, targetPath, {
                        resolveSIDs: true,
                        isIdentityMappingAvailable: jobContext.jobConfig.options.isIdentityMappingAvailable,
                        jobID: jobContext.jobRunId
                    });

                    if (comparisonResult.isEqual) {
                    } else {
                        // Debug: Log what we're comparing
                        // logData.push(`Source principals: ${comparisonResult.source.permissions.map(p => p.principal).join(', ')}`);
                        // logData.push(`Target principals: ${comparisonResult.target.permissions.map(p => p.principal).join(', ')}`);
                        
                        if (comparisonResult.differences.onlyInSource.length > 0) {
                            logData.push(`Missing in target (${comparisonResult.differences.onlyInSource.length} entries):`);
                            comparisonResult.differences.onlyInSource.forEach(entry => {
                                logData.push(`- ${entry.principal} (${entry.accessType})`);
                            });
                        }

                        if (comparisonResult.differences.onlyInTarget.length > 0) {
                            //logData.push(`Extra in target (${comparisonResult.differences.onlyInTarget.length} entries):`);
                            comparisonResult.differences.onlyInTarget.forEach(entry => {
                              //  logData.push(`- ${entry.principal} (${entry.accessType})`);
                            });
                        }

                        if (comparisonResult.differences.different.length > 0) {
                            logData.push(`Different permissions (${comparisonResult.differences.different.length} entries):`);
                            comparisonResult.differences.different.forEach(diff => {
                                logData.push(`- ${diff.principal}: source=[${diff.sourcePermissions.map(p => p.code).join(',')}] vs target=[${diff.targetPermissions.map(p => p.code).join(',')}]`);
                            });
                        }

                        if (command.ops[OPS_CMD.STAMP_META].params) {
                            command.ops[OPS_CMD.STAMP_META].params.aclComparison = {
                                isEqual: comparisonResult.isEqual,
                                onlyInSourceCount: comparisonResult.differences.onlyInSource.length,
                                onlyInTargetCount: comparisonResult.differences.onlyInTarget.length,
                                differentCount: comparisonResult.differences.different.length,
                                identicalCount: comparisonResult.differences.identical.length
                            };
                        }
                    }
                } catch (compareError) {
                    if (compareError instanceof FileAccessError) {
                        logData.push(`Cannot compare ACLs - file no longer accessible: ${compareError.message}`);
                    } else {
                        logData.push(`Failed to compare ACLs: ${compareError.message}`);
                    }
                }
            }

            if (!stampData.success) {
                const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, errorType, command.id,
                    new Error('ACL stamping failed'), { name: command.fPath, path: targetPath });
                await jobContext.publishToErrorStream(dmErr);
                output.targetErrors.push('ACL_STAMP_FAILED');
            }
            if (logData.length > 0) {
                const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, errorType, command.id, new Error(`Stamping ACLs Errors:\n${logData.join('\n')}`),
                    { name: command.fPath, path: targetPath });
                await jobContext.publishToErrorStream(dmErr);
            }
            command.ops[OPS_CMD.STAMP_META].status = OPS_STATUS.COMPLETED;

        } catch (error) {
            this.logger.error(`Stamping ACLs from ${sourcePath} to ${targetPath}, Error: ${error.message}`, error.stack);
            if (error instanceof FileAccessError) {
                const dmErr = dmError("OPERATION", Origin.SOURCE, Operation.STAMP_META, errorType, command.id, error,
                    { name: command.fPath, path: sourcePath });
                await jobContext.publishToErrorStream(dmErr);
                output.sourceErrors.push('FILE_ACCESS_ERROR');
            } else {
                const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, errorType, command.id, error,
                    { name: command.fPath, path: targetPath });
                await jobContext.publishToErrorStream(dmErr);
                output.targetErrors.push(error.code || 'UNKNOWN_ERROR');
            }
        }

        return output;
    }



    async stampFileAttrMeta({ command, jobContext, sourcePath, targetPath, errorType }: CommandExecInput): Promise<StampMetaOutput> {
        const output: StampMetaOutput = { sourceErrors: [], targetErrors: [] };
        if (process.platform !== 'win32') return output;
        try {
            const fileAttr = await this.shellService.runCommand(`attrib ${sourcePath}`);
            command.ops[OPS_CMD.STAMP_META].params.fileAttr = fileAttr.trim()?.split(/\s+/)?.filter(token => !this.attributeRegex.test(token)).join('')
            this.logger.debug(`File attributes for ${sourcePath}: ${command.ops[OPS_CMD.STAMP_META].params.fileAttr}`);

        } catch (error) {
            this.logger.error(`Getting Attribute for ${sourcePath}, Error: ${error.message}`, error.stack);
            const dmErr = dmError("OPERATION", Origin.SOURCE, Operation.STAMP_META, errorType, command.id, error, { name: command.fPath, path: targetPath });
            await jobContext.publishToErrorStream(dmErr);
            output.sourceErrors.push(error.code);
            return output;
        }
        try {
            let attributeFlags = '';
            if (command.ops[OPS_CMD.STAMP_META].params.fileAttr?.includes('H')) attributeFlags += '+H ';
            if (command.ops[OPS_CMD.STAMP_META].params.fileAttr?.includes('S')) attributeFlags += '+S ';
            if (command.ops[OPS_CMD.STAMP_META].params.fileAttr?.includes('R')) attributeFlags += '+R ';
            if (command.ops[OPS_CMD.STAMP_META].params.fileAttr?.includes('A')) attributeFlags += '+A ';

            this.logger.debug(`Setting file attributes for ${targetPath}: ${attributeFlags}`);

            if (attributeFlags) {
                const command = `attrib ${attributeFlags.trim()} "${targetPath}"`;
                this.logger.debug(`Setting file attributes for ${targetPath}: ${command}`);
                await this.shellService.runCommand(command);
            }

        } catch (error) {
            this.logger.error(`Transferring ACL to ${targetPath}, Error: ${error.message}`, error.stack);
            const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, errorType, command.id, error, { name: command.fPath, path: targetPath });
            await jobContext.publishToErrorStream(dmErr);
            output.targetErrors.push(error.code);
        }

        return output;
    }

}