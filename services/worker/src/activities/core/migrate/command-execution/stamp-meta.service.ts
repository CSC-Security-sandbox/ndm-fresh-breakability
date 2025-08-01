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

            // Skip the pre-check for deny permissions in production
            const stampData = await aclOps.stampFileACL(sourcePath, targetPath, {
                preserveExisting: false,
                excludePrincipals: [],
                includePrincipals: [],
                resolveSIDs: true,
                isIdentityMappingAvailable: jobContext.jobConfig.options.isIdentityMappingAvailable,
                jobID: jobContext.jobRunId,
                disableInheritance: false
            });

            // Process results
            let grantCount = 0;
            let denyCount = 0;
            let skipCount = 0;
            let failCount = 0;

            // Track critical failures only
            const criticalErrors: string[] = [];

            stampData.operations.forEach(op => {
                if (op.type === 'grant' && op.status === 'completed') {
                    grantCount++;
                } else if (op.type === 'deny' && op.status === 'completed') {
                    denyCount++;
                } else if (op.type === 'skip') {
                    skipCount++;
                } else if (op.status === 'failed') {
                    failCount++;
                    // Only track non-SID mapping failures as critical
                    if (!op.error?.includes('1332') && !op.error?.includes('No mapping')) {
                        criticalErrors.push(`${op.type} ${op.principal}: ${op.error}`);
                    }
                }
            });

            // Skip comparison for performance in production unless there were failures
            if (failCount > 0 && criticalErrors.length > 0) {
                // Log critical errors only
                const errorMessage = `ACL stamping had ${criticalErrors.length} critical failures`;
                this.logger.error(`ACL stamping errors from ${sourcePath} to ${targetPath}`, errorMessage);

                const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, errorType, command.id,
                    new Error(`${errorMessage}: ${criticalErrors.slice(0, 3).join('; ')}${criticalErrors.length > 3 ? '...' : ''}`),
                    { name: command.fPath, path: targetPath });
                await jobContext.publishToErrorStream(dmErr);
                output.targetErrors.push('ACL_STAMP_FAILED');
            }

            // Store summary statistics for monitoring
            if (command.ops[OPS_CMD.STAMP_META].params) {
                command.ops[OPS_CMD.STAMP_META].params.aclStats = {
                    granted: grantCount,
                    denied: denyCount,
                    skipped: skipCount,
                    failed: failCount,
                    success: stampData.success
                };
            }

            // Perform ACL comparison after stamping
            if (stampData.success || failCount < stampData.operations.length) {
                try {
                    // Remove the fixed delay - it's not scalable for millions of files
                    // await new Promise(resolve => setTimeout(resolve, 1000)); // Remove this

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
                        // Success - no logging needed
                    } else {
                        // Only log comparison differences if there were actual stamp failures
                        // This avoids false positives due to timing issues
                        if (failCount > 0 || denyCount === 0 && stampData.operations.some(op => op.type === 'deny')) {
                            if (comparisonResult.differences.onlyInSource.length > 0) {
                                logData.push(`Missing in target (${comparisonResult.differences.onlyInSource.length} entries):`);
                                comparisonResult.differences.onlyInSource.forEach(entry => {
                                    // Highlight if it's a deny permission
                                    const prefix = entry.accessType === 'deny' ? 'DENY -' : '-';
                                    logData.push(`${prefix} ${entry.principal} (${entry.accessType})`);
                                });
                            }

                            if (comparisonResult.differences.different.length > 0) {
                                logData.push(`Different permissions (${comparisonResult.differences.different.length} entries):`);
                                comparisonResult.differences.different.forEach(diff => {
                                    logData.push(`- ${diff.principal}: source=[${diff.sourcePermissions.map(p => p.code).join(',')}] vs target=[${diff.targetPermissions.map(p => p.code).join(',')}]`);
                                });
                            }
                        }

                        // Always store the comparison results for monitoring
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
                    // Comparison errors are not critical - log but don't fail the operation
                    if (compareError instanceof FileAccessError) {
                        this.logger.debug(`Cannot compare ACLs - file no longer accessible: ${compareError.message}`);
                    } else {
                        this.logger.debug(`Failed to compare ACLs: ${compareError.message}`);
                    }
                }
            }

            if (!stampData.success) {
                // Collect error details from failed operations
                const errorDetails = stampData.operations
                    .filter(op => op.status === 'failed')
                    .map(op => `${op.type} ${op.principal}: ${op.error}`)
                    .join('; ');

                // Also count skipped unresolved SIDs
                const unresolvedSIDs = stampData.operations
                    .filter(op => op.type === 'skip' && op.reason?.includes('unresolved SID'))
                    .length;

                const errorMessage = errorDetails
                    ? `ACL stamping failed: ${errorDetails}${unresolvedSIDs > 0 ? ` (${unresolvedSIDs} unresolved SIDs skipped)` : ''}`
                    : `ACL stamping failed${unresolvedSIDs > 0 ? ` (${unresolvedSIDs} unresolved SIDs skipped)` : ''}`;

                this.logger.error(`ACL stamping failed from ${sourcePath} to ${targetPath}`, errorMessage);
                const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, errorType, command.id,
                    new Error(errorMessage), { name: command.fPath, path: targetPath });
                await jobContext.publishToErrorStream(dmErr);
                output.targetErrors.push('ACL_STAMP_FAILED');
            }
            if (logData.length > 0) {
                // Only report as error if there were actual stamp failures
                if (failCount > 0) {
                    const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, errorType, command.id, new Error(`Stamping ACLs Errors:\n${logData.join('\n')}`),
                        { name: command.fPath, path: targetPath });
                    await jobContext.publishToErrorStream(dmErr);
                    output.targetErrors.push('ACL_STAMP_FAILED');

                    return output;
                    //output.targetErrors.push("ACL_STAMP_FAILED");
                } else {
                    // Log as warning/info for monitoring purposes
                    this.logger.warn(`ACL comparison differences for ${targetPath}:\n${logData.join('\n')}`);
                }
            }
            // command.ops[OPS_CMD.STAMP_META].status = OPS_STATUS.COMPLETED;

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
            // Get source attributes
            const sourceAttrOutput = await this.shellService.runCommand(`attrib "${sourcePath}"`);
            const sourceAttrs = sourceAttrOutput.trim()?.split(/\s+/)?.filter(token => !this.attributeRegex.test(token)).join('') || '';
            
            // Get target attributes to compare
            const targetAttrOutput = await this.shellService.runCommand(`attrib "${targetPath}"`);
            const targetAttrs = targetAttrOutput.trim()?.split(/\s+/)?.filter(token => !this.attributeRegex.test(token)).join('') || '';
            
            command.ops[OPS_CMD.STAMP_META].params.fileAttr = sourceAttrs;
            this.logger.debug(`Source attributes for ${sourcePath}: ${sourceAttrs}`);
            this.logger.debug(`Target attributes for ${targetPath}: ${targetAttrs}`);

        } catch (error) {
            this.logger.error(`Getting Attribute for ${sourcePath}, Error: ${error.message}`, error.stack);
            const dmErr = dmError("OPERATION", Origin.SOURCE, Operation.STAMP_META, errorType, command.id, error, { name: command.fPath, path: targetPath });
            await jobContext.publishToErrorStream(dmErr);
            output.sourceErrors.push(error.code);
            return output;
        }
        
        try {
            const sourceAttrs = command.ops[OPS_CMD.STAMP_META].params.fileAttr || '';
            
            // First, clear all attributes on target
            // This ensures we start fresh and match source exactly
            const clearCmd = `attrib -R -A -S -H "${targetPath}"`;
            await this.shellService.runCommand(clearCmd);
            
            // Then apply only the attributes from source
            let attributeFlags = '';
            
            // Check each possible attribute
            // R = Read-only
            if (sourceAttrs.includes('R')) attributeFlags += '+R ';
            
            // A = Archive
            if (sourceAttrs.includes('A')) attributeFlags += '+A ';
            
            // S = System
            if (sourceAttrs.includes('S')) attributeFlags += '+S ';
            
            // H = Hidden
            if (sourceAttrs.includes('H')) attributeFlags += '+H ';
            
            // I = Not content indexed (if present)
            if (sourceAttrs.includes('I')) attributeFlags += '+I ';
            
            this.logger.debug(`Setting file attributes for ${targetPath}: ${attributeFlags || 'none'}`);

            if (attributeFlags) {
                const setCmd = `attrib ${attributeFlags.trim()} "${targetPath}"`;
                this.logger.debug(`Setting file attributes command: ${setCmd}`);
                await this.shellService.runCommand(setCmd);
            }

        } catch (error) {
            this.logger.error(`Setting file attributes for ${targetPath}, Error: ${error.message}`, error.stack);
            const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, errorType, command.id, error, { name: command.fPath, path: targetPath });
            await jobContext.publishToErrorStream(dmErr);
            output.targetErrors.push(error.code);
        }

        return output;
    }

}