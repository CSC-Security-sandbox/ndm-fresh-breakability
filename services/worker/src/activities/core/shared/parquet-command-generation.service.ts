import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cmd, CmdMeta, CommandStatus, ErrorType, FileInfo, JobManagerContext, OPS_CMD, OPS_STATUS, ParquetItem } from "@netapp-cloud-datamigrate/jobs-lib";
import { uuid4 } from "@temporalio/workflow";
import * as fs from "fs";
import * as path from "path";
import { dmError, getFileInfo, isAtimeUpdated, isContentUpdate, isMetaUpdated, removePrefix, getExcludeOrSkipReason } from "src/activities/utils/utils";
import { RedisService } from "src/redis/redis.service";
import { Operation, Origin } from "src/activities/utils/utils.types";
import { LoggerService, LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { isExists } from "../utils/utils";
import { FileTypeDetectionService } from "../utils/file-type-detection.service";
import { FileType } from "src/activities/types/tasks";
import { DeferredDirStamp, DeferredDirStampService } from "./deferred-dir-stamp.service";
import { SecurityDescriptorChangeDetectorService } from "../migrate/command-execution/win-opeartions/security-descriptor-change-detector.service";
import {
    LocalSetLookup,
    RedisSetLookup,
    ProcessItemInput,
    ProcessItemSettings,
    ProcessItemResult,
    ProcessItemsInput,
    ProcessItemsResult,
    TargetContentLookup,
} from "./command-generation.service";

export { LocalSetLookup, RedisSetLookup };
export type { TargetContentLookup, ProcessItemInput, ProcessItemSettings, ProcessItemResult, ProcessItemsInput, ProcessItemsResult };

function buildParquetItem(jobRunId: string, sourceStat: fs.Stats, relativeSourcePath: string): ParquetItem {
    const fileType = sourceStat.isDirectory() ? 'DIRECTORY'
        : sourceStat.isSymbolicLink() ? 'SYMBOLIC_LINK'
            : 'FILE';
    return new ParquetItem(
        jobRunId,
        relativeSourcePath,
        fileType,
        sourceStat.size,
        sourceStat.mtime,
        sourceStat.mode,
        sourceStat.uid,
        sourceStat.gid,
        sourceStat.atime,
        sourceStat.birthtime,
        sourceStat.ctime,
        sourceStat.ino,
        null,
    );
}

@Injectable()
export class ParquetCommandGenerationService {
    private readonly maxMigrationCommand: number;
    private readonly logger: LoggerService;

    constructor(
        @Inject(ConfigService) private readonly configService: ConfigService,
        @Inject(LoggerFactory) loggerFactory: LoggerFactory,
        private readonly fileTypeDetectionService: FileTypeDetectionService,
        private readonly redisService: RedisService,
        private readonly securityDescriptorChangeDetector: SecurityDescriptorChangeDetectorService,
    ) {
        this.maxMigrationCommand = this.configService.get('worker.maxMigrationCommand') || 100;
        this.logger = loggerFactory.create(ParquetCommandGenerationService.name);
    }

    /**
     * Process multiple items, generate commands, and publish ParquetItems to the parquet stream.
     * Dual-publishes: commands → command stream, metadata → parquet stream.
     */
    async processItems(input: ProcessItemsInput): Promise<ProcessItemsResult> {
        const {
            items,
            sourcePath,
            targetPath,
            sourcePrefix,
            targetPrefix,
            jobContext,
            command,
            settings,
            errorType,
            targetContent,
            maxCommandsPerBatch = this.maxMigrationCommand
        } = input;

        const result: ProcessItemsResult = {
            commands: [],
            fileCount: 0,
            dirCount: 0,
            totalSize: 0,
            subDirs: [],
            excludedPaths: [],
            skippedPaths: [],
        };

        const parquetItems: ParquetItem[] = [];

        const isSMB = process.platform === 'win32';
        let lowerCaseSourceData: Set<string> | undefined;

        if (isSMB) {
            lowerCaseSourceData = new Set<string>();
        }

        const allItemNames = items.map(item => item.fPath ? path.basename(item.fPath) : item.name);
        const targetMembershipResults = await targetContent.hasMany(allItemNames);
        const targetHasItem = new Map<string, boolean>();
        for (let i = 0; i < allItemNames.length; i++) {
            targetHasItem.set(allItemNames[i], targetMembershipResults[i]);
        }

        let targetLcHasItem: Map<string, boolean> | undefined;
        if (isSMB && input.targetLcLookup) {
            const lcNames = allItemNames.map(n => n.toLowerCase());
            const lcResults = await input.targetLcLookup.hasMany(lcNames);
            targetLcHasItem = new Map<string, boolean>();
            for (let i = 0; i < lcNames.length; i++) {
                targetLcHasItem.set(lcNames[i], lcResults[i]);
            }
        }

        for (const itemData of items) {
            const itemName = itemData.fPath ? path.basename(itemData.fPath) : itemData.name;
            const relativePath = itemData.fPath || itemData.name;
            const sourceContentPath = itemData.fPath
                ? path.join(sourcePrefix, itemData.fPath)
                : path.join(sourcePath, itemData.name);
            try {
                const sourceContentExists = await isExists(sourceContentPath);
                if (!sourceContentExists) {
                    if (itemData.originalCommandId) {
                        const resolvedCommand: Cmd = this.buildResolvedCommand(relativePath, itemData.isDir || false, itemData.originalCommandId);
                        result.commands.push(resolvedCommand);
                    }
                    continue;
                }

                const sourceStat = await fs.promises.lstat(sourceContentPath);
                const relativeSourcePath = itemData.fPath || removePrefix(sourceContentPath, sourcePrefix);

                const excludeOrSkipReason = getExcludeOrSkipReason({
                    fullPath: sourceContentPath,
                    stats: sourceStat,
                    excludePatterns: settings.excludePatterns,
                    skipTime: settings.skipFile,
                    olderThan: jobContext.jobConfig.options?.excludeOlderThan
                        ? new Date(jobContext.jobConfig.options.excludeOlderThan)
                        : undefined,
                    jobType: jobContext.jobConfig.jobType,
                });
                if (excludeOrSkipReason !== null) {
                    if (itemData.originalCommandId) {
                        const resolvedCommand: Cmd = this.buildResolvedCommand(relativePath, sourceStat.isDirectory(), itemData.originalCommandId);
                        result.commands.push(resolvedCommand);
                    }
                    continue;
                }

                if (isSMB) {
                    const hasSMBError: boolean = await this.SMBSpecificChecks(jobContext, command, itemName, lowerCaseSourceData!, relativeSourcePath, sourceContentPath, targetLcHasItem, targetHasItem, sourceStat.isDirectory(), errorType);
                    if (hasSMBError) continue;
                }

                const fileInfo: FileInfo = await getFileInfo({
                    name: itemName,
                    fullFilePath: sourceContentPath,
                    relativePath: relativeSourcePath
                });
                const fileType = await this.fileTypeDetectionService.detectFileType(sourceContentPath, sourceStat);

                const itemInTarget = targetHasItem.get(itemName) || false;

                if (sourceStat.isDirectory() && !sourceStat.isSymbolicLink()) {
                    result.dirCount++;

                    if (isSMB && fileType === FileType.VOLUME_MOUNT_POINT) {
                        const transientError = new Error(`Volume mount point detected at ${relativeSourcePath}`);
                        await jobContext.publishToErrorStream(
                            dmError("OPERATION", Origin.SOURCE, Operation.READ_DIR, ErrorType.TRANSIENT_ERROR, command?.id, transientError, { name: relativeSourcePath, path: relativeSourcePath }),
                            jobContext.jobConfig?.jobRunId
                        );
                        continue;
                    }
                    if (!itemInTarget) {
                        result.subDirs.push(relativeSourcePath);
                        const newCommand = await this.buildCommand(sourceStat, fileInfo.path, undefined, itemData.originalCommandId, jobContext);
                        if (newCommand) result.commands.push(newCommand);
                        await this.recordDeferredDirStamp(input.deferredDirStampService, jobContext, relativeSourcePath, sourceStat);
                    } else if (itemData.originalCommandId) {
                        const targetDirPath = path.join(targetPath, itemName);
                        const targetDirStat = await fs.promises.lstat(targetDirPath);
                        const newCommand = await this.buildCommand(sourceStat, fileInfo.path, targetDirStat, itemData.originalCommandId, jobContext, sourceContentPath, targetDirPath);
                        if (newCommand) result.commands.push(newCommand);
                        await this.recordDeferredDirStamp(input.deferredDirStampService, jobContext, relativeSourcePath, sourceStat);
                    } else {
                        result.subDirs.push(relativeSourcePath);

                        const targetDirPath = path.join(targetPath, itemName);
                        const targetDirExists = await isExists(targetDirPath);
                        if (targetDirExists) {
                            const targetDirStat = await fs.promises.lstat(targetDirPath);
                            const newCommand = await this.buildCommand(sourceStat, fileInfo.path, targetDirStat, undefined, jobContext, sourceContentPath, targetDirPath);
                            if (newCommand) result.commands.push(newCommand);
                        }
                        await this.recordDeferredDirStamp(input.deferredDirStampService, jobContext, relativeSourcePath, sourceStat);
                    }
                } else if (sourceStat.isSymbolicLink()) {
                    if (!itemInTarget) {
                        if (isSMB && (fileType === FileType.JUNCTION || fileType === FileType.SYMBOLIC_LINK)) {
                            const transientError = new Error(`${fileType} detected at ${relativeSourcePath}`);
                            await jobContext.publishToErrorStream(
                                dmError("OPERATION", Origin.SOURCE, Operation.READ_DIR, ErrorType.TRANSIENT_ERROR, command?.id, transientError, { name: relativeSourcePath, path: relativeSourcePath }),
                                jobContext.jobConfig?.jobRunId
                            );
                            continue;
                        }
                        const newCommand = await this.buildCommand(sourceStat, fileInfo.path, undefined, itemData.originalCommandId, jobContext);
                        if (newCommand) result.commands.push(newCommand);
                    } else {
                        const targetFilePath = path.join(targetPath, itemName);
                        const targetStatLstat = await fs.promises.lstat(targetFilePath);
                        const newCommand = await this.buildCommand(sourceStat, fileInfo.path, targetStatLstat, itemData.originalCommandId, jobContext, sourceContentPath, targetFilePath);
                        if (newCommand) result.commands.push(newCommand);
                    }
                } else if (!itemInTarget) {
                    result.fileCount++;
                    result.totalSize += sourceStat.size;
                    const newCommand = await this.buildCommand(sourceStat, fileInfo.path, undefined, itemData.originalCommandId, jobContext);
                    if (newCommand) result.commands.push(newCommand);
                } else {
                    const targetFilePath = path.join(targetPath, itemName);
                    const targetFileExists = await isExists(targetFilePath);
                    if (targetFileExists) {
                        const targetStatLstat = await fs.promises.lstat(targetFilePath);
                        let targetStat: fs.Stats;
                        if (targetStatLstat.isSymbolicLink()) {
                            targetStat = targetStatLstat;
                        } else {
                            targetStat = await fs.promises.stat(targetFilePath);
                        }
                        const newCommand = await this.buildCommand(sourceStat, fileInfo.path, targetStat, itemData.originalCommandId, jobContext, sourceContentPath, targetFilePath);
                        if (newCommand) result.commands.push(newCommand);
                    }
                }

                // Build and accumulate parquet item for every successfully processed item
                parquetItems.push(buildParquetItem(jobContext.jobRunId, sourceStat, relativeSourcePath));

                // Flush commands in batches
                if (result.commands.length >= maxCommandsPerBatch) {
                    const chunk = result.commands.splice(0, maxCommandsPerBatch);
                    await jobContext.publishBulkToCommandStream(chunk);
                }

                // Flush parquet items in batches (independent of command batch boundary)
                if (parquetItems.length >= maxCommandsPerBatch) {
                    const parquetChunk = parquetItems.splice(0, maxCommandsPerBatch);
                    await jobContext.publishToParquetStreamBulk(parquetChunk);
                }

            } catch (error) {
                this.logger.error(`Error processing item ${itemName} in directory ${sourcePath}: ${error}`);
                const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.READ_DIR, errorType, command?.id, error, { name: command?.fPath || relativePath, path: targetPath });
                await jobContext.publishToErrorStream(dmErr, jobContext.jobConfig?.jobRunId);
                throw error;
            }
        }

        // Flush any remaining parquet items after the loop
        if (parquetItems.length > 0) {
            await jobContext.publishToParquetStreamBulk(parquetItems.splice(0));
        }

        return result;
    }

    private async SMBSpecificChecks(jobContext: JobManagerContext, command: Cmd, itemName: string, lowerCaseSourceData: Set<string>, relativeSourcePath: string, sourceContentPath: string, targetLcHasItem: Map<string, boolean> | undefined, targetHasItem: Map<string, boolean>, isDirectory: boolean, errorType: ErrorType): Promise<boolean> {
        const errorOpId = command?.id || '';
        const hasConflict = await this.checkAndPublishCaseConflictError(
            jobContext.jobConfig.jobType,
            itemName,
            lowerCaseSourceData!,
            relativeSourcePath,
            sourceContentPath,
            errorOpId,
            jobContext,
            targetLcHasItem,
            targetHasItem,
            isDirectory
        );
        if (hasConflict) return true;

        const hasTrailingSpace = await this.checkAndPublishTrailingSpaceError(
            itemName,
            relativeSourcePath,
            sourceContentPath,
            errorOpId,
            jobContext,
            errorType
        );
        if (hasTrailingSpace) return true;

        return false;
    }

    private async checkAndPublishTrailingSpaceError(
        item: string,
        relativeSourcePath: string,
        sourceContentPath: string,
        operationId: string,
        jobContext: JobManagerContext,
        errorType: ErrorType
    ): Promise<boolean> {
        if (!item.endsWith(' ') && !item.endsWith('\t')) {
            return false;
        }
        const error = new Error(`File not migrated: filename contains trailing spaces`) as Error & { code: string };
        error.code = 'ETRAILSPACE';
        const dmErr = dmError(
            "OPERATION",
            Origin.SOURCE,
            Operation.READ_FILE,
            ErrorType.TRANSIENT_ERROR,
            operationId,
            error,
            { name: relativeSourcePath, path: sourceContentPath }
        );
        await jobContext.publishToErrorStream(dmErr, jobContext.jobConfig?.jobRunId);
        return true;
    }

    private async checkAndPublishCaseConflictError(
        jobType: string,
        itemName: string,
        lowerCaseSourceData: Set<string>,
        relativeSourcePath: string,
        sourceContentPath: string,
        operationId: string,
        jobContext: JobManagerContext,
        targetLcHasItem?: Map<string, boolean>,
        targetHasItem?: Map<string, boolean>,
        isDirectory?: boolean
    ): Promise<boolean> {
        const lowerCaseFileName = itemName.toLowerCase();
        if (lowerCaseSourceData.has(lowerCaseFileName) || (targetLcHasItem?.get(lowerCaseFileName) && !targetHasItem?.get(itemName))) {
            const isDiscovery = jobType === "DISCOVER";
            const itemType = isDirectory ? 'Directory' : 'File';
            const errorMessage = isDiscovery
                ? "Directory contents not discovered: Another directory with same name but different case exists"
                : `${itemType} not migrated: Another ${itemType.toLowerCase()} with same name but different case exists`;
            const error = new Error(errorMessage) as Error & { code: string };
            error.code = 'EEXIST';
            const origin = isDiscovery ? Origin.SOURCE : Origin.DESTINATION;
            const operationName: Operation = isDiscovery ? Operation.READ_DIR : Operation.COPY_CONTENT;
            const dmErr = dmError("OPERATION", origin, operationName, ErrorType.TRANSIENT_ERROR, operationId, error, { name: relativeSourcePath, path: sourceContentPath });
            await jobContext.publishToErrorStream(dmErr, jobContext.jobConfig?.jobRunId);
            return true;
        }
        lowerCaseSourceData.add(lowerCaseFileName);
        return false;
    }

    async buildCommand(
        sFile: fs.Stats,
        fPath: string,
        dFile?: fs.Stats,
        originalCommandId?: string,
        jobContext?: JobManagerContext,
        sourceAbsPath?: string,
        targetAbsPath?: string,
        applyInheritanceMode = false,
    ): Promise<Cmd | undefined> {
        const metadata: CmdMeta = {
            size: sFile.size,
            mtime: sFile.mtime,
            mode: sFile.mode,
            uid: sFile.uid,
            gid: sFile.gid,
            atime: sFile.atime,
            ctime: sFile.ctime,
            birthtime: sFile.birthtime,
            sid: undefined,
            inode: sFile.ino,
            isSymLink: sFile.isSymbolicLink()
        };

        const targetExisted = !!dFile;
        if (isContentUpdate(sFile, dFile)) {
            const isDirectory = sFile.isDirectory();
            return new Cmd(
                uuid4(),
                fPath,
                CommandStatus.READY,
                isDirectory,
                {
                    [this.getOpsCommand(isDirectory, metadata.isSymLink)]: { status: OPS_STATUS.READY, params: { targetExisted } },
                    [OPS_CMD.STAMP_META]: { status: OPS_STATUS.READY, params: {} }
                },
                metadata,
                originalCommandId
            );
        }

        if (jobContext?.jobConfig?.options?.preservePermissions && await isMetaUpdated(sFile, dFile, this.redisService, jobContext, this.securityDescriptorChangeDetector, sourceAbsPath, targetAbsPath, applyInheritanceMode)) {
            const isDirectory = sFile.isDirectory();
            return new Cmd(
                uuid4(),
                fPath,
                CommandStatus.READY,
                isDirectory,
                {
                    [this.getOpsCommand(isDirectory, metadata.isSymLink)]: { status: OPS_STATUS.COMPLETED, params: { targetExisted } },
                    [OPS_CMD.STAMP_META]: { status: OPS_STATUS.READY, params: {} }
                },
                metadata,
                originalCommandId
            );
        }

        if (jobContext?.jobConfig?.options?.preserveAccessTime && isAtimeUpdated(sFile, dFile)) {
            const isDirectory = sFile.isDirectory();
            this.logger.debug(`atime-only change detected | path=${fPath} | src=${sFile.atime.toISOString()} dst=${dFile.atime.toISOString()}`);
            return new Cmd(
                uuid4(),
                fPath,
                CommandStatus.READY,
                isDirectory,
                {
                    [this.getOpsCommand(isDirectory, metadata.isSymLink)]: { status: OPS_STATUS.COMPLETED, params: { targetExisted } },
                    [OPS_CMD.STAMP_ATIME]: { status: OPS_STATUS.READY, params: {} }
                },
                metadata,
                originalCommandId
            );
        }

        return undefined;
    }

    getOpsCommand(isDirectory: boolean, isSymLink: boolean): string {
        if (isSymLink) {
            return OPS_CMD.COPY_SYMLINK;
        }
        return isDirectory ? OPS_CMD.COPY_DIR : OPS_CMD.COPY_FILE;
    }

    private buildResolvedCommand(fPath: string, isDirectory: boolean, originalCommandId: string): Cmd {
        return new Cmd(
            uuid4(),
            fPath,
            CommandStatus.COMPLETED,
            isDirectory,
            {},
            undefined,
            originalCommandId
        );
    }

    async recordDeferredDirStamp(
        deferredDirStampService: DeferredDirStampService | undefined,
        jobContext: JobManagerContext,
        relativeSourcePath: string,
        sourceStat: fs.Stats,
    ): Promise<void> {
        if (!deferredDirStampService) return;
        if (!sourceStat?.mtime || !sourceStat?.atime) return;
        const record: DeferredDirStamp = {
            fPath: relativeSourcePath,
            atime: new Date(sourceStat.atime).toISOString(),
            mtime: new Date(sourceStat.mtime).toISOString(),
            depth: DeferredDirStampService.computeDepth(relativeSourcePath),
        };
        await deferredDirStampService.add(jobContext.jobRunId, record);
    }
}
