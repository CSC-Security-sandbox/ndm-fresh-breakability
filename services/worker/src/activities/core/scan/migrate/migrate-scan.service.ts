import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cmd, CmdMeta, CommandStatus, ErrorType, JobManagerContext, OPS_CMD, OPS_STATUS } from "@netapp-cloud-datamigrate/jobs-lib";
import { uuid4 } from "@temporalio/workflow";
import * as fs from "fs";
import * as path from "path";
import { dmError, isContentUpdate, isMetaUpdated, removePrefix, shouldExcludeForDelete } from "src/activities/utils/utils";
import { Operation, Origin } from "src/activities/utils/utils.types";
import { FatalError } from "src/errors/errors.types";
import { DirContentsInput, PublishCommandInput } from "./migrate-scan.type";
import { ScanDirectoryInput, ScanDirectoryOutput, ScanDirectorySettings } from "../scan-activity.type";
import { LoggerService, LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { isPathExists } from "../../utils/utils";
import { FileTypeDetectionService } from "../../utils/file-type-detection.service";
import { CommandGenerationService, LocalSetLookup } from "../../shared/command-generation.service";
import { DeferredDirStampService } from "../../shared/deferred-dir-stamp.service";


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
        private readonly deferredDirStampService: DeferredDirStampService,
    ) {
        this.workerId = this.configService.get<string>('worker.workerId');
        this.maxMigrationCommand = this.configService.get('worker.maxMigrationCommand') || 100;
        this.maxConcurrency = this.configService.get('worker.maxCommandConcurrency') || 100; 
        this.maxRetryCount = this.configService.get('worker.maxRetryCount') || 3;
        this.metaUpdatedToleranceMs = this.configService.get<number>('worker.metaUpdatedToleranceMs') ;
        this.logger = loggerFactory.create(MigrateScanService.name);
    }


    async publishCommands({ jobContext, commands}: PublishCommandInput)  {
        await jobContext.publishBulkToCommandStream(commands);
    }

    /**
     * Initialises DLM root directory stamping once per migration.
     * Short-circuits on any task that is not the initial root scan task
     * (single command, fPath='/'), so batch subdirectory tasks are never
     * processed here.
     *
     * Delegates to two focused helpers:
     *   - `publishDlmRootPermissionStamp` — emits the STAMP_META command that
     *     applies ACL / mode / ownership on the destination root.
     *     Guarded by `preservePermissions` — skipped when permissions are not
     *     being migrated.
     *   - `registerDlmRootMtimeRestamp`   — registers the root in the deferred
     *     mtime/atime restamp queue so child writes cannot clobber its timestamps.
     *     Always runs — mtime must be preserved regardless of permission settings.
     */
    async initDlmRootStamp(
        task: { commands: Cmd[] },
        jobContext: JobManagerContext,
        sourcePath: string,
        targetPath: string,
    ): Promise<void> {
        if (!jobContext.jobConfig?.sourceDirectoryPath) return;
        if (task.commands.length !== 1 || task.commands[0].fPath !== '/') return;

        const sourceRootStat = await fs.promises.lstat(sourcePath);
        let targetRootStat: fs.Stats | undefined;
        try {
            targetRootStat = await fs.promises.lstat(targetPath);
        } catch {
            // First run — destination root not yet created. buildCommand's
            // !dFile branch returns a fresh COPY_DIR+STAMP_META cmd.
        }

        if (jobContext.jobConfig?.options?.preservePermissions) {
            await this.publishDlmRootPermissionStamp(sourceRootStat, targetRootStat, jobContext);
        }
        await this.registerDlmRootMtimeRestamp(sourceRootStat, jobContext);
    }

    /**
     * Builds and publishes a STAMP_META command for the DLM root dir (`fPath='/'`).
     * Skips if `buildCommand` determines nothing has changed (incremental guard).
     *
     * Sets `applyInheritanceMode: true` so `stampAclOperation` converts inherited
     * ACEs from the source into explicit ACEs on the destination root — the only
     * root-specific behaviour vs. normal child-dir stamping.
     */
    private async publishDlmRootPermissionStamp(
        sourceRootStat: fs.Stats,
        targetRootStat: fs.Stats | undefined,
        jobContext: JobManagerContext,
    ): Promise<void> {
        const rootCmd = await this.commandGenerationService.buildCommand(
            sourceRootStat, '/', targetRootStat, undefined, jobContext,
        );
        if (!rootCmd) return;
        rootCmd.ops[OPS_CMD.STAMP_META].params.applyInheritanceMode = true;
        await this.publishCommands({ jobContext, commands: [rootCmd] });
    }

    /**
     * Registers the DLM root dir (`fPath='/'`, depth=0) in the deferred
     * mtime/atime restamp queue.
     *
     * Every child write clobbers a parent directory's mtime, so the
     * per-command STAMP_META timestamp is meaningless for directories.
     * `restampDirectoriesActivity` drains this queue deepest-first at the
     * end of the migration — depth=0 ensures the root is restamped last,
     * after all descendants.
     */
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
        const sourceContent = await this.getDirContents({path: sourcePath, origin: Origin.SOURCE, jobContext, errorType, command});
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
      

        if (await isMetaUpdated(sFile, dFile, this.metaUpdatedToleranceMs)) {
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
