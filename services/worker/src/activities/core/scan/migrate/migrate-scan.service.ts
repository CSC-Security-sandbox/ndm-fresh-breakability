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
import { CommandGenerationService } from "../../shared/command-generation.service";


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
        private readonly commandGenerationService: CommandGenerationService
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

        const output: ScanDirectoryOutput = { fileCount: 0, dirCount: 0, totalSize: 0, subDirs: []}
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
            targetContent,
            maxCommandsPerBatch: this.maxMigrationCommand
        });

                if (isSMB){
                    const hasConflict = await checkCaseSensitiveConflict(
                        jobContext.jobConfig.jobType,
                        item,
                        lowerCaseSourceData,
                        relativeSourcePath,
                        sourceContentPath,
                        command,
                        jobContext,
                        lowerCaseTargetData,
                        targetContent,
                        sourceStat.isDirectory()
                    );
                    if (hasConflict) continue;

                    const hasTrailingSpace = await this.checkAndPublishTrailingSpaceError(
                        item,
                        relativeSourcePath,
                        sourceContentPath,
                        command,
                        jobContext,
                        errorType
                    );
                    if (hasTrailingSpace) continue;
                    // TODO: check if the item has streams or not using detectADsInfo method. 
                    // buildCOmmand with sourceStat and a new ComamndName - COPY_CONTTENT_STREAMS
                }

                const fileInfo: FileInfo = await getFileInfo({name: item, fullFilePath: sourceContentPath, relativePath: relativeSourcePath});
                const fileType = await this.fileTypeDetectionService.detectFileType(sourceContentPath, sourceStat);
                // TODO: change the if/else logic. it is difficult to read and understand.
                if (sourceStat.isDirectory() && !sourceStat.isSymbolicLink()) {   // only resolving to directory
                    output.dirCount++;
                    if ((process.platform === 'win32') && (fileType === FileType.VOLUME_MOUNT_POINT)) {
                        const transientError = new Error(`Volume mount point detected at ${relativeSourcePath}`);
                        await jobContext.publishToErrorStream(
                            dmError("OPERATION", Origin.SOURCE, Operation.READ_DIR, ErrorType.TRANSIENT_ERROR, command.id, transientError, { name: relativeSourcePath, path: relativeSourcePath })
                        );
                        continue;
                    }
                    output.subDirs.push(relativeSourcePath);
                    if(!targetContent.has(item)) {
                        const newcommand = this.buildCommand(sourceStat, fileInfo.path);
                        if (newcommand) commands.push(newcommand);
                    }
                } 
                 else if (sourceStat.isSymbolicLink()) {   // not a directory but a sym link                                                                             
                    if(!targetContent.has(item)) {
                        if ((process.platform === 'win32') && (fileType === FileType.JUNCTION || fileType === FileType.SYMBOLIC_LINK)) {
                            const transientError = new Error(`${fileType} detected at ${relativeSourcePath}`);
                                await jobContext.publishToErrorStream(
                                    dmError("OPERATION", Origin.SOURCE, Operation.READ_DIR, ErrorType.TRANSIENT_ERROR, command.id, transientError, { name: relativeSourcePath, path: relativeSourcePath })
                                );
                            continue;
                        }
                        const newcommand = this.buildCommand(sourceStat, fileInfo.path);
                        if (newcommand) commands.push(newcommand);
                    }else{
                        const targetFilePath = path.join(targetPath, item);
                        const targetStatLstat = await fs.promises.lstat(targetFilePath);
                        const command = this.buildCommand(sourceStat, fileInfo.path, targetStatLstat);
                        if (command) commands.push(command);
                    }
                }
                else if (!targetContent.has(item)) {                       // not directory and not symlink and target dont exist
                    output.fileCount++;
                    output.totalSize += sourceStat.size;
                    const command = this.buildCommand(sourceStat, fileInfo.path);
                    if (command) commands.push(command);
                } else {                                                   // not directory and not symlink and target exist                           
                    const targetFilePath = path.join(targetPath, item);
                    const targetFileExists = await isExists(targetFilePath);
                    if (targetFileExists) {
                       const targetStatLstat = await fs.promises.lstat(targetFilePath);
                        let targetStat: fs.Stats;
                        if (targetStatLstat.isSymbolicLink()) {
                            targetStat = targetStatLstat;
                        } else {
                            targetStat = await fs.promises.stat(targetFilePath);
                        }
                        const command = this.buildCommand(sourceStat, fileInfo.path, targetStat);
                        if (command) commands.push(command);
                    }
                }
                //TODO: this is duplicated many times, need to refactor.
                if(commands.length >= this.maxMigrationCommand) {
                    const chunk = commands.splice(0, this.maxMigrationCommand);
                    await this.publishCommands({ jobContext, commands: chunk });
                }
                
            }catch(error) {
                this.logger.error(`Error processing item ${item} in directory ${sourcePath}: ${error}`);
                const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.READ_DIR, errorType, command.id, error, {name: command.fPath, path: targetPath});
                await jobContext.publishToErrorStream(dmErr);
                throw error; 
            }
        }
        
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
