import { Inject, Injectable } from "@nestjs/common";
import { OPS_CMD, OPS_STATUS } from "@netapp-cloud-datamigrate/jobs-lib";
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import * as fs from "fs";
import { ShellService } from "src/activities/common/shell.service";
import { dmError } from "src/activities/utils/utils";
import { Operation, Origin } from "src/activities/utils/utils.types";
import { RedisService } from "src/redis/redis.service";
import { CommandExecInput, CommandOutput } from "./command-execution.type";
import { StampMetaOutput } from "./stamp-meta.type";

import {
    ACLOperations, aclToOneLineString, FileAccessError
} from './aclOperations';

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
                const hiddenAttrOutput = await this.stampFileAttributeMeta(input);
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

                this.logger.warn(`[${command.id}] File not accessible for ACL stamping: ${missingFile}`);
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
            this.logger.log(`[${command.id}] Starting ACL stamp from ${sourcePath} to ${targetPath}`);

            const stampData = await aclOps.stampFileACL(sourcePath, targetPath, {
                preserveExisting: false,
                excludePrincipals: [],
                includePrincipals: [],
                resolveSIDs: true,
                isIdentityMappingAvailable: jobContext.jobConfig.options.isIdentityMappingAvailable,
                jobID: jobContext.jobRunId,
                disableInheritance: false
            });

            this.logger.log(`[${command.id}] ACL stamp completed. Success: ${stampData.success}, Operations: ${stampData.operations.length}`);

            let grantCount = 0;
            let denyCount = 0;
            let skipCount = 0;
            let failCount = 0;

            const criticalErrors: string[] = [];
            const noMappingErrors: string[] = [];

            for (const op of stampData.operations) {
                switch (op.status) {
                    case 'completed':
                        if (op.type === 'grant') grantCount++;
                        else if (op.type === 'deny') denyCount++;
                        break;
                    case 'failed':
                        failCount++;
                        if (op.error?.includes('No mapping') || op.error?.includes('1332')) {
                            noMappingErrors.push(`${op.type.toUpperCase()} ${op.principal}: ${op.error}`);
                        } else {
                            criticalErrors.push(`${op.type.toUpperCase()} ${op.principal}: ${op.error}`);
                        }
                        break;
                    case 'skipped':
                        skipCount++;
                        if (op.reason?.includes('unresolved SID')) {
                            noMappingErrors.push(`SKIP ${op.principal}: ${op.reason}`);
                        }
                        break;
                }
            }

            const summary = `ACL stamping summary for ${targetPath}: ${grantCount} granted, ${denyCount} denied, ${skipCount} skipped, ${failCount} failed`;
            this.logger.log(`[${command.id}] ${summary}`);

            if (failCount > 0 && criticalErrors.length > 0) {
                const errorMessage = `ACL stamping had ${criticalErrors.length} critical failures`;
                this.logger.error(`[${command.id}] ${errorMessage}`);
                const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, errorType, command.id,
                    new Error(`${errorMessage}: ${criticalErrors.slice(0, 3).join('; ')}${criticalErrors.length > 3 ? '...' : ''}`),
                    { name: command.fPath, path: targetPath });
                await jobContext.publishToErrorStream(dmErr);
                output.targetErrors.push('ACL_STAMP_FAILED');
                return output;
            }

            if (command.ops[OPS_CMD.STAMP_META].params) {
                command.ops[OPS_CMD.STAMP_META].params.aclStats = {
                    granted: grantCount,
                    denied: denyCount,
                    skipped: skipCount,
                    failed: failCount,
                    success: stampData.success
                };
            }

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

                    if (!comparisonResult.isEqual) {
                        if (failCount > 0 || (denyCount === 0 && stampData.operations.some(op => op.type === 'deny'))) {
                            if (comparisonResult.differences.onlyInSource.length > 0) {
                                logData.push(`Missing in target (${comparisonResult.differences.onlyInSource.length} entries):`);
                                for (const entry of comparisonResult.differences.onlyInSource) {
                                    const prefix = entry.accessType === 'deny' ? 'DENY -' : '-';
                                    logData.push(`${prefix} ${entry.principal} (${entry.accessType})`);
                                }
                            }

                            if (comparisonResult.differences.different.length > 0) {
                                logData.push(`Different permissions (${comparisonResult.differences.different.length} entries):`);
                                for (const diff of comparisonResult.differences.different) {
                                    logData.push(`- ${diff.principal}: source=[${diff.sourcePermissions.map(p => p.code).join(',')}] vs target=[${diff.targetPermissions.map(p => p.code).join(',')}]`);
                                }
                            }
                        }

                        if (logData.length > 0 || noMappingErrors.length > 0) {
                            const combinedLogSet = new Set([...logData, ...noMappingErrors]);
                            this.logger.log(`[${command.id}] ACL stamping log for ${targetPath}:\n${[...combinedLogSet].join('\n')}`);

                            const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, errorType, command.id, new Error([...combinedLogSet].join('\n')),
                                { name: command.fPath, path: sourcePath });
                            await jobContext.publishToErrorStream(dmErr);
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
                    command.ops[OPS_CMD.STAMP_META].params.sidMap = {
                        targetAcl: aclToOneLineString(comparisonResult.target),
                        sourceAcl: aclToOneLineString(comparisonResult.source),
                    };

            } catch (compareError) {
                const message = compareError instanceof FileAccessError
                    ? `Cannot compare ACLs - file no longer accessible: ${compareError.message}`
                    : `Failed to compare ACLs: ${compareError.message}`;
                this.logger.warn(`[${command.id}] ${message}`);
            }
        }

        if (!stampData.success) {
            const errorDetails = stampData.operations
                .filter(op => op.status === 'failed')
                .map(op => `${op.type} ${op.principal}: ${op.error}`)
                .join('; ');

            const unresolvedSIDs = stampData.operations
                .filter(op => op.type === 'skip' && op.reason?.includes('unresolved SID'))
                .length;

            const errorMessage = errorDetails
                ? `ACL stamping failed: ${errorDetails}${unresolvedSIDs > 0 ? ` (${unresolvedSIDs} unresolved SIDs skipped)` : ''}`
                : `ACL stamping failed${unresolvedSIDs > 0 ? ` (${unresolvedSIDs} unresolved SIDs skipped)` : ''}`;
            this.logger.error(`[${command.id}] ${errorMessage}`);
            const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, errorType, command.id,
                new Error(`${errorMessage}: ${criticalErrors.slice(0, 3).join('; ')}${criticalErrors.length > 3 ? '...' : ''}`),
                { name: command.fPath, path: targetPath });
            await jobContext.publishToErrorStream(dmErr);
            output.targetErrors.push('ACL_STAMP_FAILED');
            command.ops[OPS_CMD.STAMP_META].params.error = errorMessage;
            return output;
        }

       

    } catch (error) {
        this.logger.error(`[${command.id}] Stamping ACLs from ${sourcePath} to ${targetPath}, Error: ${error.message}`, error.stack);
        const origin = error instanceof FileAccessError ? Origin.SOURCE : Origin.DESTINATION;
        const errorCode = error.code || 'UNKNOWN_ERROR';
        const dmErr = dmError("OPERATION", origin, Operation.STAMP_META, errorType, command.id, error,
            { name: command.fPath, path: origin === Origin.SOURCE ? sourcePath : targetPath });
        await jobContext.publishToErrorStream(dmErr);
        if (origin === Origin.SOURCE) {
            output.sourceErrors.push('FILE_ACCESS_ERROR');
        } else {
            output.targetErrors.push(errorCode);
        }
    }

    return output;
}


async stampFileAttributeMeta({ command, jobContext, sourcePath, targetPath, errorType }: CommandExecInput): Promise<StampMetaOutput> {
        const output: StampMetaOutput = { sourceErrors: [], targetErrors: [] };
        if (process.platform !== 'win32') return output;
        let sourceAttributes = '';
        let targetAttributes = '';
        try {
            const fileAttr = await this.shellService.runCommand(`attrib "${sourcePath}"`);
            sourceAttributes = fileAttr?.trim().split(/\s+/).filter(token => !this.attributeRegex.test(token)).join('');
            command.ops[OPS_CMD.STAMP_META].params.fileAttr = sourceAttributes;
            this.logger.log(`Source file attributes for ${sourcePath}: ${sourceAttributes}`);
        } catch (error) {
            this.logger.error(`Getting source attributes for ${sourcePath}, Error: ${error.message}`, error.stack);
            const dmErr = dmError("OPERATION", Origin.SOURCE, Operation.STAMP_META, errorType, command.id, error, { name: command.fPath, path: targetPath });
            await jobContext.publishToErrorStream(dmErr);
            output.sourceErrors.push(error.code);
            return output;
        }

        try {
            const targetAttr = await this.shellService.runCommand(`attrib "${targetPath}"`);
            targetAttributes = targetAttr?.trim().split(/\s+/).filter(token => !this.attributeRegex.test(token)).join('');
            this.logger.log(`Target file attributes for ${targetPath}: ${targetAttributes}`);
        } catch (error) {
            this.logger.warn(`Could not get target attributes for ${targetPath}, assuming no attributes: ${error.message}`);
            targetAttributes = '';
        }

        try {
            const attributesToAdd = [];
            const attributesToRemove = [];
            const allAttributes = ['H', 'S', 'R', 'A'];

            for (const attr of allAttributes) {
                const sourceHasAttr = sourceAttributes.includes(attr);
                const targetHasAttr = targetAttributes.includes(attr);

                if (sourceHasAttr && !targetHasAttr) {
                    attributesToAdd.push(`+${attr}`);
                } else if (!sourceHasAttr && targetHasAttr) {
                    attributesToRemove.push(`-${attr}`);
                }
            }
            const allAttributeChanges = [...attributesToAdd, ...attributesToRemove];

            this.logger.log(`Attribute changes needed for ${targetPath}: ${allAttributeChanges.join(' ')}`);

            if (allAttributeChanges.length > 0) {
                const attributeCommand = `attrib ${allAttributeChanges.join(' ')} "${targetPath}"`;
                this.logger.log(`Executing attribute command: ${attributeCommand}`);
                await this.shellService.runCommand(attributeCommand);
                try {
                    const verifyAttr = await this.shellService.runCommand(`attrib "${targetPath}"`);
                    const finalAttributes = verifyAttr?.trim().split(/\s+/).filter(token => !this.attributeRegex.test(token)).join('');

                    if (finalAttributes === sourceAttributes) {
                        this.logger.log(`Attributes successfully synchronized for ${targetPath}: ${finalAttributes}`);
                    } else {
                        this.logger.warn(`Attribute mismatch after sync - Expected: ${sourceAttributes}, Actual: ${finalAttributes}`);
                    }
                } catch (verifyError) {
                    this.logger.warn(`Could not verify attribute changes: ${verifyError.message}`);
                }
            } else {
                this.logger.log(`No attribute changes needed for ${targetPath} - already synchronized`);
            }

        } catch (error) {
            this.logger.error(`Setting/removing attributes for ${targetPath} failed, Error: ${error.message}`, error.stack);
            const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, errorType, command.id, error, { name: command.fPath, path: targetPath });
            await jobContext.publishToErrorStream(dmErr);
            output.targetErrors.push(error.code);
        }

        return output;
    }


    async removeFileAttributeTemporarily(path: string): Promise<boolean> {
        if (process.platform !== 'win32') return false;
        try {
            const fileAttr = await this.shellService.runCommand(`attrib "${path}"`);
            const attributes = fileAttr?.trim().split(/\s+/).filter(token => !this.attributeRegex.test(token)).join('');
            let attributesToRemove = '';
            if (attributes.includes('H')) {
                attributesToRemove = '-H';
            }
            if (attributes.includes('R')) {
                attributesToRemove += ' -R';
            }
            if (attributesToRemove) {
                this.logger.log(`Removing  attribute for ${path}: ${attributesToRemove}`);
                await this.shellService.runCommand(`attrib ${attributesToRemove} "${path}"`);
                this.logger.log(`Successfully removed ${attributesToRemove} attribute for ${path}`);
                return true;
            }
        } catch (error) {
            this.logger.error(`Error during Removing attribute for ${path}, Error: ${error.message}`, error.stack);
        }
        return false;
    }
    async restoreFileAttribute(path: string): Promise<boolean> {
        if (process.platform !== 'win32') return false;
        try {
            const fileAttr = await this.shellService.runCommand(`attrib "${path}"`);
            const attributes = fileAttr?.trim().split(/\s+/).filter(token => !this.attributeRegex.test(token)).join('');
            let attributesToAdd = '';
            if (!attributes.includes('H')) {
                attributesToAdd = '+H';
            }
            if (!attributes.includes('R')) {
                attributesToAdd += ' +R';
            }
            if (attributesToAdd) {
                this.logger.log(`Restoring attribute for ${path}: ${attributesToAdd}`);
                await this.shellService.runCommand(`attrib ${attributesToAdd} "${path}"`);
                this.logger.log(`Successfully restored ${attributesToAdd} attribute for ${path}`);
                return true;
            }
        } catch (error) {
            this.logger.error(`Error during restoring attribute for ${path}, Error: ${error.message}`, error.stack);
        }
        return false;
    }
}

