import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cmd, CmdMeta, CommandStatus, ErrorType, JobManagerContext, OPS_CMD, OPS_STATUS } from "@netapp-cloud-datamigrate/jobs-lib";
import { uuid4 } from "@temporalio/workflow";
import * as fs from "fs";
import * as path from "path";
import { dmError, isContentUpdate, isMetaUpdated, isDirectoryLevelMigration, removePrefix, shouldExcludeForDelete } from "src/activities/utils/utils";
import { Operation, Origin } from "src/activities/utils/utils.types";
import { FatalError } from "src/errors/errors.types";
import { DirContentsInput, PublishCommandInput } from "./migrate-scan.type";
import { ScanDirectoryInput, ScanDirectoryOutput, ScanDirectorySettings } from "../scan-activity.type";
import { LoggerService, LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { isPathExists } from "../../utils/utils";
import { FileTypeDetectionService } from "../../utils/file-type-detection.service";
import { CommandGenerationService, LocalSetLookup } from "../../shared/command-generation.service";
import { DeferredDirStampService } from "../../shared/deferred-dir-stamp.service";
import { captureSourceDirAtimeStat, preserveSourceDirAtime } from "../scan-utils";


@Injectable()
export class MigrateScanService {
    readonly workerId: string;
    readonly maxMigrationCommand : number;
    readonly maxConcurrency: number;
    readonly maxRetryCount: number;
    private readonly logger: LoggerService;

    constructor(
        @Inject(ConfigService) 
        private readonly configService: ConfigService,
        @Inject(LoggerFactory) loggerFactory: LoggerFactory,
        private readonly fileTypeDetectionService: FileTypeDetectionService,
        private readonly commandGenerationService: CommandGenerationService,
        private readonly deferredDirStampService: DeferredDirStampService,
    ) {
        this.workerId = this.configService.get<string>('worker.workerId');
        this.maxMigrationCommand = this.configService.get('worker.maxMigrationCommand') || 100;
        this.maxConcurrency = this.configService.get('worker.maxCommandConcurrency') || 100; 
        this.maxRetryCount = this.configService.get('worker.maxRetryCount') || 3;
        this.logger = loggerFactory.create(MigrateScanService.name);
    }


    async publishCommands({ jobContext, commands}: PublishCommandInput)  {
        await jobContext.publishBulkToCommandStream(commands);
    }

    async initDlmRootStamp(
        task: { commands: Cmd[] },
        jobContext: JobManagerContext,
        sourcePath: string,
        targetPath: string,
    ): Promise<void> {
        if (!isDirectoryLevelMigration(jobContext.jobConfig)) return;
        if (task.commands.length !== 1 || task.commands[0].fPath !== '/') return;

        let sourceRootStat: fs.Stats | undefined;
        let targetRootStat: fs.Stats | undefined;
        try {
            sourceRootStat = await fs.promises.lstat(sourcePath);
            targetRootStat = await fs.promises.lstat(targetPath);
        } catch (err) {
            if (!sourceRootStat) {
                this.logger.error(`Failed to stat DLM root source path: ${sourcePath} — ${err.message}`);
                return;
            }
            this.logger.log(`DLM root not yet present on destination: ${targetPath} — first run, fresh COPY_DIR+STAMP_META will be emitted`);
        }

        if (jobContext.jobConfig?.options?.preservePermissions) {
            await this.publishDlmRootPermissionStamp(sourceRootStat, targetRootStat, jobContext, sourcePath, targetPath);
        }
        await this.registerDlmRootMtimeRestamp(sourceRootStat, jobContext);
    }

    private async publishDlmRootPermissionStamp(
        sourceRootStat: fs.Stats,
        targetRootStat: fs.Stats | undefined,
        jobContext: JobManagerContext,
        sourcePath: string,
        targetPath: string,
    ): Promise<void> {
        // This method is the single decision point for "is this the DLM
        // root?" — both the stamp-side flag on the command (set below) and
        // the gate-side `applyInheritanceMode` arg to buildCommand are
        // pinned to `true` here. buildCommand threads the arg through to
        // isMetaUpdated -> hasSecurityDescriptorChanged so the gate's
        // expected-destination SD matches what stamp will actually write.
        //
        // sourcePath/targetPath are required: on win32, when destination
        // already exists and target mtime matches source (the steady state
        // after the previous run's deferred dir-stamp), buildCommand falls
        // through to isMetaUpdated, which needs both abs paths.
        const rootCmd = await this.commandGenerationService.buildCommand(
            sourceRootStat, '/', targetRootStat, undefined, jobContext, sourcePath, targetPath, true,
        );
        if (!rootCmd) return;
        rootCmd.ops[OPS_CMD.STAMP_META].params.applyInheritanceMode = true;
        await this.publishCommands({ jobContext, commands: [rootCmd] });
    }

    private async registerDlmRootMtimeRestamp(
        sourceRootStat: fs.Stats,
        jobContext: JobManagerContext,
    ): Promise<void> {
        await this.commandGenerationService.recordDeferredDirStamp(
            this.deferredDirStampService, jobContext, '/', sourceRootStat,
        );
    }

    async getDirContents({path, origin, jobContext, errorType, command}: DirContentsInput): Promise<Set<string>>{
        let content = new Set<string>();
        try{
            const pathExists = await isPathExists(path);
            if (!pathExists) {
                if (origin === Origin.SOURCE)  
                    throw new FatalError(`Source directory does not exist: ${path}`);
                return content; 
            }
            content = new Set<string>( await fs.promises.readdir(path)); 
        }catch(error){
            if(error instanceof FatalError) 
                errorType = ErrorType.FATAL_ERROR;
            const ndmError = dmError("OPERATION", origin, Operation.READ_DIR, errorType, command.id, error, {name: command.fPath, path: path});
            await jobContext.publishToErrorStream(ndmError);
            throw error; 
        }
        return content;
    }

    async scanDirectory({ jobContext, sourcePath, sourcePrefix, targetPath , command, settings , targetPrefix, errorType}: ScanDirectoryInput): Promise<ScanDirectoryOutput> {

        const output: ScanDirectoryOutput = { fileCount: 0, dirCount: 0, subDirs: []}
        let commands: Cmd[] = [];

        const preserveAccessTime = jobContext.jobConfig?.options?.preserveAccessTime;
        let sourceDirStat: fs.Stats | undefined;
        if (preserveAccessTime) {
            try {
                sourceDirStat = await captureSourceDirAtimeStat(sourcePath, this.logger);
            } catch (err) {
                const dmErr = dmError('OPERATION', Origin.SOURCE, Operation.READ_DIR, errorType, command.id, err, { name: command.fPath, path: sourcePath });
                await jobContext.publishToErrorStream(dmErr);
                throw err;
            }
        }

        const sourceContent = await this.getDirContents({path: sourcePath, origin: Origin.SOURCE, jobContext, errorType, command});

        if (sourceDirStat) {
            await preserveSourceDirAtime(sourcePath, sourceDirStat, jobContext, command, this.logger, errorType);
        }
        const targetContent = await this.getDirContents({path: targetPath, origin: Origin.DESTINATION, jobContext, errorType, command});

        const items = Array.from(sourceContent, name => ({ name }));

        // Process items using shared service
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
            targetContent: new LocalSetLookup(targetContent),
            maxCommandsPerBatch: this.maxMigrationCommand,
            deferredDirStampService: this.deferredDirStampService,
        });

        // Update output with results
        output.fileCount = processResult.fileCount;
        output.dirCount = processResult.dirCount;
        output.subDirs = processResult.subDirs;
        output.excludedPaths = processResult.excludedPaths ?? [];
        output.skippedPaths = processResult.skippedPaths ?? [];
        commands = processResult.commands;

        if (jobContext?.jobConfig?.skipDelete === false) {
            //TODO: remove command as it is not required. 
            await this.processDeletedItems({
                sourceContent,
                targetContent,
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
            await this.publishCommands({ jobContext, commands: commands });
            commands = [];
        }
        return output
    }

    async processDeletedItems({ sourceContent, targetContent, targetPath, targetPrefix, jobContext, errorType, command, commands ,settings}: {
        sourceContent: Set<string>,
        targetContent: Set<string>,
        targetPath: string,
        targetPrefix: string,
        jobContext: JobManagerContext,
        errorType: ErrorType,
        command: Cmd,
        commands: Cmd[],
        settings: ScanDirectorySettings
    }) {
        for (const targetItem of targetContent) {
            if (!sourceContent.has(targetItem)) {
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
                        const deleteCommand = await this.buildCommand(null, relativeSourcePath, targetStat);
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

    buildCommand = async (sFile: fs.Stats | undefined, fPath: string, dFile?: fs.Stats): Promise<Cmd | undefined> => {

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
        // TODO : Remove this dead code as this call will always be for files which has been deleted in source and will never reach this part of code
        // There is no sFile ever as this is a delete operation 
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
      

        if (await isMetaUpdated(sFile, dFile)) {
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
