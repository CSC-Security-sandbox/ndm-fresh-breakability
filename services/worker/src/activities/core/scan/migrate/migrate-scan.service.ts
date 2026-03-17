import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cmd, CmdMeta, CommandStatus, ErrorType, JobManagerContext, OPS_CMD, OPS_STATUS } from "@netapp-cloud-datamigrate/jobs-lib";
import { uuid4 } from "@temporalio/workflow";
import * as fs from "fs";
import * as path from "path";
import { dmError, isContentUpdate, isMetaUpdated, removePrefix, shouldExcludeForDelete } from "src/activities/utils/utils";
import { Operation, Origin } from "src/activities/utils/utils.types";
import { FatalError } from "src/errors/errors.types";
import { PublishCommandInput } from "./migrate-scan.type";
import { ScanDirectoryInput, ScanDirectoryOutput, ScanDirectorySettings } from "../scan-activity.type";
import { LoggerService, LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { isPathExists } from "../../utils/utils";
import { FileTypeDetectionService } from "../../utils/file-type-detection.service";
import { CommandGenerationService, RedisSetLookup } from "../../shared/command-generation.service";
import { DirStreamingService } from "../../shared/dir-streaming.service";


@Injectable()
export class MigrateScanService {
    readonly workerId: string;
    readonly maxMigrationCommand : number;
    readonly maxConcurrency: number;
    readonly maxRetryCount: number;
    readonly metaUpdatedToleranceMs: number;
    private readonly logger: LoggerService;

    constructor(
        @Inject(ConfigService)
        private readonly configService: ConfigService,
        @Inject(LoggerFactory) loggerFactory: LoggerFactory,
        private readonly fileTypeDetectionService: FileTypeDetectionService,
        private readonly commandGenerationService: CommandGenerationService,
        private readonly dirStreamingService: DirStreamingService,
    ) {
        this.workerId = this.configService.get<string>('worker.workerId');
        this.maxMigrationCommand = this.configService.get('worker.maxMigrationCommand') || 100;
        this.maxConcurrency = this.configService.get('worker.maxCommandConcurrency') || 100;
        this.maxRetryCount = this.configService.get('worker.maxRetryCount') || 3;
        this.metaUpdatedToleranceMs = this.configService.get('worker.metaUpdatedToleranceMs') || 60000;
        this.logger = loggerFactory.create(MigrateScanService.name);
    }


    async publishCommands({ jobContext, commands}: PublishCommandInput)  {
        await jobContext.publishBulkToCommandStream(commands);
    }

    async scanDirectory({ jobContext, sourcePath, sourcePrefix, targetPath, command, settings, targetPrefix, errorType}: ScanDirectoryInput): Promise<ScanDirectoryOutput> {
        const output: ScanDirectoryOutput = { fileCount: 0, dirCount: 0, totalSize: 0, subDirs: []}
        let commands: Cmd[] = [];

        const isSMB = process.platform === 'win32';
        const targetRedisKey = this.dirStreamingService.getDirContentKey(targetPath);
        const sourceRedisKey = this.dirStreamingService.getDirContentKey(sourcePath);

        try {
            // Stream target directory entries into a Redis Set (bulk SADD calls)
            await this.dirStreamingService.streamDirToRedisSet({
                dirPath: targetPath,
                redisKey: targetRedisKey,
                jobContext,
                origin: Origin.DESTINATION,
                errorType: errorType || ErrorType.RECOVERABLE_ERROR,
                command,
                buildLowercaseSet: isSMB,
            });

            const targetLookup = new RedisSetLookup(jobContext, targetRedisKey);
            const targetLcLookup = isSMB ? new RedisSetLookup(jobContext, `${targetRedisKey}:lc`) : undefined;

            // Track whether we need source Redis Set for delete detection
            const needsDeleteDetection = jobContext?.jobConfig?.skipDelete === false;

            // Stream source directory entries in batches via opendir()
            for await (const batch of this.dirStreamingService.streamDirEntries(sourcePath)) {
                // If delete detection is needed, also store source entries in a Redis Set
                if (needsDeleteDetection) {
                    await jobContext.addToDirContentSet(sourceRedisKey, batch);
                }

                const items = batch.map(name => ({ name }));

                const processResult = await this.commandGenerationService.processItems({
                    items,
                    sourcePath,
                    targetPath,
                    sourcePrefix,
                    targetPrefix,
                    jobContext,
                    command,
                    settings: {
                        skipFile: settings.skipFile,
                        excludePatterns: settings.excludePatterns
                    },
                    errorType: errorType || ErrorType.RECOVERABLE_ERROR,
                    targetContent: targetLookup,
                    targetLcLookup,
                    maxCommandsPerBatch: this.maxMigrationCommand
                });

                output.fileCount += processResult.fileCount;
                output.dirCount += processResult.dirCount;
                output.totalSize += processResult.totalSize;
                output.subDirs.push(...processResult.subDirs);
                commands.push(...processResult.commands);

                // Flush accumulated commands
                if (commands.length >= this.maxMigrationCommand) {
                    const chunk = commands.splice(0, this.maxMigrationCommand);
                    await this.publishCommands({ jobContext, commands: chunk });
                }
            }

            // Delete detection: find target entries not present in source
            if (needsDeleteDetection) {
                await this.processDeletedItems({
                    sourceRedisKey,
                    targetRedisKey,
                    targetPath,
                    targetPrefix,
                    jobContext,
                    errorType,
                    command,
                    commands,
                    settings
                });
            }

            if (commands.length > 0) {
                await this.publishCommands({ jobContext, commands });
                commands = [];
            }

            return output;
        } finally {
            // Cleanup temporary Redis Sets
            await jobContext.deleteDirContentSet(targetRedisKey).catch(() => {});
            await jobContext.deleteDirContentSet(sourceRedisKey).catch(() => {});
            if (isSMB) {
                await jobContext.deleteDirContentSet(`${targetRedisKey}:lc`).catch(() => {});
            }
        }
    }

    /**
     * Delete detection using Redis SSCAN + SMISMEMBER.
     * Iterates target entries in batches, checks each batch against source Redis Set.
     */
    async processDeletedItems({ sourceRedisKey, targetRedisKey, targetPath, targetPrefix, jobContext, errorType, command, commands, settings}: {
        sourceRedisKey: string,
        targetRedisKey: string,
        targetPath: string,
        targetPrefix: string,
        jobContext: JobManagerContext,
        errorType: ErrorType,
        command: Cmd,
        commands: Cmd[],
        settings: ScanDirectorySettings
    }) {
        for await (const nonMembers of this.dirStreamingService.scanForNonMembers(jobContext, targetRedisKey, sourceRedisKey)) {
            for (const targetItem of nonMembers) {
                const targetContentPath = path.join(targetPath, targetItem);
                try {
                    const targetContentExists = await isPathExists(targetContentPath);
                    if (targetContentExists) {
                        const targetStat = await fs.promises.lstat(targetContentPath);

                        if (shouldExcludeForDelete({
                            fullPath: targetContentPath,
                            excludePatterns: settings.excludePatterns,
                        })) continue;

                        const relativeSourcePath = removePrefix(targetContentPath, targetPrefix);
                        const deleteCommand = this.buildCommand(null, relativeSourcePath, targetStat);
                        if (deleteCommand) {
                            commands.push(deleteCommand);
                        }
                    }
                    if (commands.length >= this.maxMigrationCommand) {
                        const chunk = commands.splice(0, this.maxMigrationCommand);
                        await this.publishCommands({ jobContext, commands: chunk });
                    }
                } catch (error) {
                    this.logger.error(`[${jobContext.jobRunId}] Error processing  ${targetContentPath}: ${error}`);
                    const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.READ_DIR, errorType, command.id, error, { name: command.fPath, path: targetPath });
                    await jobContext.publishToErrorStream(dmErr);
                    throw error;
                }
            }
        }
    }

    buildCommand = (sFile: fs.Stats | undefined, fPath: string, dFile?: fs.Stats): Cmd | undefined => {

        // Add extra info here based on which we will generate OPS_CMD COPY_STREAMS.
        // OPS_CMD.COPY_STREAM_DIRS and then deelete the file and delete the STREAM_DIRs as well.
        if (!sFile) {
            const isDirectory = dFile ? dFile.isDirectory() : false;
            return new Cmd(
                uuid4(),
                fPath,
                CommandStatus.READY,
                isDirectory,
                {
                    [isDirectory ? OPS_CMD.REMOVE_DIR : OPS_CMD.REMOVE_FILE]:
                        { status: OPS_STATUS.READY, params: {} }
                }
            )
        }
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
            isSymLink: sFile.isSymbolicLink() ? true : false
        }

        if (isContentUpdate(sFile, dFile)) {
            const isDirectory = sFile.isDirectory();
            return new Cmd(
                uuid4(),
                fPath,
                CommandStatus.READY,
                isDirectory,
                {
                    [this.getOpsCommand(isDirectory, metadata.isSymLink)]: { status: OPS_STATUS.READY, params: {} },
                    [OPS_CMD.STAMP_META]: { status: OPS_STATUS.READY, params: {} }
                },
                metadata,
            )
        }


        if (isMetaUpdated(sFile, dFile, this.metaUpdatedToleranceMs)) {
            const isDirectory = sFile.isDirectory();
            return new Cmd(
                uuid4(),
                fPath,
                CommandStatus.READY,
                isDirectory,
                {
                    [this.getOpsCommand(isDirectory, metadata.isSymLink)]: { status: OPS_STATUS.COMPLETED , params: {} },
                    [OPS_CMD.STAMP_META]: { status: OPS_STATUS.READY, params: {} }
                },
                metadata,
            )
        }
        return undefined;
    }


    getOpsCommand(isDirectory: boolean, isSymLink: boolean): string {
        if(isSymLink){
            return OPS_CMD.COPY_SYMLINK;
        }else{
            return isDirectory ? OPS_CMD.COPY_DIR : OPS_CMD.COPY_FILE;
        }
    }
}
