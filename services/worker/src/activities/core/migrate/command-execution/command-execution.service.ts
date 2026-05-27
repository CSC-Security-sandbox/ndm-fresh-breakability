
import { CommandStatus, ItemInfo, ItemMeta, OPS_CMD, OPS_STATUS, JobManagerContext, Cmd } from "@netapp-cloud-datamigrate/jobs-lib";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LoggerFactory, LoggerService } from "@netapp-cloud-datamigrate/logger-lib";
import * as fs from "fs";
import * as path from 'path';
import { WINDOWS } from "../../../../config/app.config";
import { dmError, getFilePermissions, getFileType } from "src/activities/utils/utils";
import { FileType } from "src/activities/types/tasks";
import { Operation, Origin } from "src/activities/utils/utils.types";
import { createDirectory } from "src/activities/utils/directory.utils";
import { WorkerThreadService } from "src/thread/worker.thread.service";
import { MetricsService } from "src/metrics/metrics.service";
import { CommandExecInput, CommandExecOutput, CommandOutput, ValidateCommandInput } from "./command-execution.type";
import { StampMetaService } from "./stamp-meta.service";
import { isNotWritable, isPathExists } from "../../utils/utils";
@Injectable()
export class CommandExecService {
    readonly workerId: string;
    private readonly logger: LoggerService;

    constructor(
        @Inject(ConfigService) private readonly configService: ConfigService,
        @Inject(LoggerFactory) loggerFactory: LoggerFactory,
        private readonly workerThreadService: WorkerThreadService,
        private readonly stampMetaService: StampMetaService,
        private readonly metricsService: MetricsService,
    ) {
        this.workerId = this.configService?.get<string>('worker.workerId') ?? '';
        this.logger = loggerFactory.create(CommandExecService.name);
    }
    async executeCommand(input: CommandExecInput): Promise<CommandExecOutput> {

        const output: CommandExecOutput = { sourceErrors: [], targetErrors: [], cmd: input.command };
        let baseCmdRes: CommandOutput = { shouldStampMeta: false, shouldUpdateItemInfo: false, sourceErrors: [], targetErrors: [] };

        // TODO: Copy Stream files in a method.

        // TODO: Copy Stream directories in a method.

        // TODO: Delete Stream files in a method.

        // TODO: Delete Stream directories in a method.

        if(input.command.ops && input.command.ops[OPS_CMD.COPY_SYMLINK]) {
            // Copy Symlink
            baseCmdRes = await this.copySymlink(input);
        }
        // Copy File
        if(input.command.ops && input.command.ops[OPS_CMD.COPY_FILE]) 
            baseCmdRes = await this.copyFile(input);

        // Copy Directory
        if(input.command.ops && input.command.ops[OPS_CMD.COPY_DIR]) 
            baseCmdRes = await this.copyDirectory(input);
    

        // Delete File
        if(input.command.ops && input.command.ops[OPS_CMD.REMOVE_FILE]) 
            baseCmdRes = await this.deleteFile(input);
        

        // Delete Directory
        if(input.command.ops && input.command.ops[OPS_CMD.REMOVE_DIR]) 
            baseCmdRes = await this.deleteDirectory(input);

        output.sourceErrors.push(...baseCmdRes.sourceErrors);
        output.targetErrors.push(...baseCmdRes.targetErrors);

       // Stamp Meta if needed
        let metaResult: CommandOutput | null = null;
        if (baseCmdRes.shouldStampMeta) {
            metaResult = await this.stampMetaService.stampMetaData(input);
            baseCmdRes.shouldUpdateItemInfo = metaResult.shouldUpdateItemInfo;
            output.targetErrors.push(...metaResult.targetErrors);
            output.sourceErrors.push(...metaResult.sourceErrors);
        }

        // COC report: compute copyContentStatus and stampMetaDataStatus for ItemInfo
        input.copyContentStatus = this.getCopyContentStatus(input.command);
        input.stampMetaDataStatus = baseCmdRes.shouldStampMeta
            ? (metaResult && (metaResult.targetErrors.length > 0 || metaResult.sourceErrors.length > 0))
                ? 'failed'
                : input.command.ops?.[OPS_CMD.STAMP_META]?.params?.error?.length
                    ? 'failed'
                    : 'success'
            : 'not_applicable';

        if( baseCmdRes.shouldUpdateItemInfo ) {
            output.itemInfo = await this.buildFileInfo(input);
        }
        if (output.sourceErrors.length > 0 || output.targetErrors.length > 0) 
            input.command.status = CommandStatus.ERROR
        else 
            input.command.status = CommandStatus.COMPLETED;

        return output
    }

    async copySymlink({command, jobContext, sourcePath, targetPath, errorType }: CommandExecInput): Promise<CommandOutput> {
        const output: CommandOutput = { shouldStampMeta: false, sourceErrors: [], targetErrors: [], shouldUpdateItemInfo: false };
        if(command.ops[OPS_CMD.COPY_SYMLINK].status === OPS_STATUS.COMPLETED) {
            output.shouldStampMeta = true;
            return output;
        }
        try {
            const linkTarget = await fs.promises.readlink(sourcePath);
            
            // Create the symbolic link
            await fs.promises.symlink(linkTarget, targetPath);
            
            output.shouldStampMeta = true;
            output.shouldUpdateItemInfo = true;
            
            this.logger.debug(`Created symbolic link: ${targetPath} -> ${linkTarget}`);
        } catch (error) {
            this.logger.error(`Copying SYMLINK from ${sourcePath} to ${targetPath}, Error: ${error.message}`, error.stack);
            const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.COPY_CONTENT, errorType, command.id, error, {name: command.fPath, path: targetPath});
            await jobContext.publishToErrorStream(dmErr, jobContext.jobConfig?.jobRunId);
            output.targetErrors.push(error.code);
        }        
    return output;
}

    async copyStreamFile(){
        //TODO: add code to enumerate the source stream and copy them one by one to target. 
        // calculate hash as well based on the streams. 
    }
    

    async copyFile({command , jobContext, sourcePath, targetPath, errorType }: CommandExecInput): Promise<CommandOutput> {
        const output: CommandOutput = { shouldStampMeta: false, sourceErrors: [], targetErrors: [] , shouldUpdateItemInfo: false };
        if(command.ops[OPS_CMD.COPY_FILE].status === OPS_STATUS.COMPLETED) {
            output.shouldStampMeta = true;
            return output;  // skip if already completed
        }
        if( command.ops[OPS_CMD.COPY_FILE].status !== OPS_STATUS.COMPLETED) {
            let [srcPathExists, targetPathExists] = await Promise.all([
                  isPathExists(sourcePath),
                  isNotWritable(targetPath),
            ])
            if(!srcPathExists) {
                const dmErr = dmError("OPERATION", Origin.SOURCE, Operation.COPY_CONTENT, errorType, command.id, 
                    new Error(`Source path does not exist: ${sourcePath}`), {name: command.fPath, path: sourcePath});
                await jobContext.publishToErrorStream(dmErr, jobContext.jobConfig?.jobRunId);
                output.sourceErrors.push('ENOENT');
                return output
            }
            try {
                if(targetPathExists)
                    await this.stampMetaService.resetFileAttributes(targetPath);

                const checksums = await this.workerThreadService.migrateWorkerThread({
                    sourcePath,
                    destinationPath: targetPath,
                    operationId: command.id,
                    size: command.metadata?.size ?? 0,
                    jobRunId: jobContext.jobRunId,
                });

                // Capture the timestamp when checksum was generated
                const checksumTime = new Date();

                output.shouldUpdateItemInfo = true;
                
                // Check for checksum mismatch before setting final status
                const existingParams = command.ops[OPS_CMD.COPY_FILE].params ?? {};
                if(checksums?.targetChecksum !== checksums?.sourceChecksum) {
                    command.ops[OPS_CMD.COPY_FILE] = { status: OPS_STATUS.ERROR, params: { ...existingParams, checksums, checksumTime } };
                    throw new Error(`Checksum mismatch detected, source: ${checksums?.sourceChecksum}, target: ${checksums?.targetChecksum}`);
                }
                // Checksums match - mark as completed (preserve targetExisted for updateType in publishFileInfo)
                command.ops[OPS_CMD.COPY_FILE] = { status: OPS_STATUS.COMPLETED, params: { ...existingParams, checksums, checksumTime } };
                output.shouldStampMeta = true;
            }catch(error){
                command.ops[OPS_CMD.COPY_FILE] = {  ... command.ops[OPS_CMD.COPY_FILE], status: OPS_STATUS.ERROR }; 
                this.logger.error(`Copying FILE from ${sourcePath} to ${targetPath}, Error: ${error.message}`, error.stack);
                const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.COPY_CONTENT, errorType, command.id, error, {name: command.fPath, path: targetPath});
                await jobContext.publishToErrorStream(dmErr, jobContext.jobConfig?.jobRunId);   
                output.targetErrors.push(error.code);
                
                // Do not attempt metadata stamping if file creation failed due to collision
                if (error.code === 'E8DOT3_COLLISION') {
                    this.logger.error(`Skipping metadata stamping for ${targetPath} due to 8.3 collision`);
                    output.shouldStampMeta = false;
                    output.shouldUpdateItemInfo = false;
                }
            }
        }
        return output;
    }

    async copyDirectory({command, jobContext, sourcePath, targetPath, errorType }: CommandExecInput): Promise<CommandOutput> {
        const output: CommandOutput = { shouldStampMeta: false, sourceErrors: [], targetErrors: [], shouldUpdateItemInfo: false };
        if(command.ops[OPS_CMD.COPY_DIR].status === OPS_STATUS.COMPLETED) {
            output.shouldStampMeta = true;
            return output;  // skip if already completed
        }
        if( command.ops[OPS_CMD.COPY_DIR].status !== OPS_STATUS.COMPLETED) {
            //TODO: add handling for the symlink to the directory. 

            try {
                await this.metricsService.runWithTiming(
                    jobContext.jobRunId,
                    MetricsService.METRIC.COPY_DIR,
                    () => createDirectory(targetPath),
                );
                command.ops[OPS_CMD.COPY_DIR].status = OPS_STATUS.COMPLETED;
                output.shouldStampMeta = true;
                output.shouldUpdateItemInfo = true;
            } catch (error) {
                command.ops[OPS_CMD.COPY_DIR].status = OPS_STATUS.ERROR;
                this.logger.error(`Copying DIR from ${sourcePath} to ${targetPath}, Error: ${error.message}`, error.stack);
                const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.COPY_CONTENT, errorType, command.id, error, {name: command.fPath, path: targetPath});
                await jobContext.publishToErrorStream(dmErr, jobContext.jobConfig?.jobRunId);
                output.targetErrors.push(error.code);
                
                // Do not attempt metadata stamping if directory creation failed due to collision
                if (error.code === 'E8DOT3_COLLISION') {
                    this.logger.debug(`Skipping metadata stamping for ${targetPath} due to 8.3 collision`);
                    output.shouldStampMeta = false;
                    output.shouldUpdateItemInfo = false;
                }
            }
        }
        return output
    }

    async deleteFile({command , jobContext, targetPath, errorType }: CommandExecInput): Promise<CommandOutput> {
        const output: CommandOutput = { shouldStampMeta: false, sourceErrors: [], targetErrors: [] , shouldUpdateItemInfo: false };
        if( command.ops[OPS_CMD.REMOVE_FILE].status !== OPS_STATUS.COMPLETED) {
            try {
                await fs.promises.unlink(targetPath);
                command.ops[OPS_CMD.REMOVE_FILE].status = OPS_STATUS.COMPLETED;
                output.shouldUpdateItemInfo = true;
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    command.ops[OPS_CMD.REMOVE_FILE].status = OPS_STATUS.ERROR;
                    this.logger.error(`Deleting FILE from  ${targetPath}, Error: ${error.message}`, error.stack);
                    const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.COPY_CONTENT, errorType, command.id, error, {name: command.fPath, path: targetPath});
                    await jobContext.publishToErrorStream(dmErr, jobContext.jobConfig?.jobRunId);
                    output.sourceErrors.push(error.code);
                }
            }
        }
        return output;
    }

    async deleteDirectory({command , jobContext, targetPath, errorType }: CommandExecInput): Promise<CommandOutput> {
        const output: CommandOutput = { shouldStampMeta: false, sourceErrors: [], targetErrors: [] , shouldUpdateItemInfo: false };
        if ( command.ops[OPS_CMD.REMOVE_DIR].status !== OPS_STATUS.COMPLETED) {
            try {
                await fs.promises.rm(targetPath, { recursive: true, force: true });
                await this.markDirectoryContentsAsDeleted(command.fPath, jobContext);
                command.ops[OPS_CMD.REMOVE_DIR].status = OPS_STATUS.COMPLETED;
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    command.ops[OPS_CMD.REMOVE_DIR].status = OPS_STATUS.ERROR;
                    this.logger.error(`Deleting DIR from  ${targetPath}, Error: ${error.message}`, error.stack);
                    const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.COPY_CONTENT, errorType, command.id, error, {name: command.fPath, path: targetPath});
                    await jobContext.publishToErrorStream(dmErr, jobContext.jobConfig?.jobRunId);
                    output.sourceErrors.push(error.code);
                }
            }
        }
        return output
    }

    /**
     * COC report: derive copyContentStatus from command ops.
     * - success: COPY_FILE completed successfully (file content copied)
     * - failed: COPY_FILE was triggered but ended in error or checksum mismatch
     * - not_applicable: no file content copy (COPY_SYMLINK, COPY_DIR only, or delete only)
     */
    private getCopyContentStatus(command: Cmd): 'success' | 'failed' | 'not_applicable' {
        if (command.ops?.[OPS_CMD.COPY_FILE]) {
            return command.ops[OPS_CMD.COPY_FILE].status === OPS_STATUS.COMPLETED ? 'success' : 'failed';
        }
        return 'not_applicable';
    }

    private async markDirectoryContentsAsDeleted(directoryPath: string, jobContext: JobManagerContext): Promise<void> {
        try {
            const deletedDirectoryInfo = new ItemInfo(
                directoryPath,                       
                true,                               
                false,                             
                directoryPath.split('/').length - 2, 
                '',                                 
                FileType.DIRECTORY.toLowerCase(),                        
                null,                              
                null,                               
                0,                                  
                0,                                  
                true,
                null // checksumTime is null for delete operations                               
            );
            await jobContext.publishToFileStream(deletedDirectoryInfo);
            this.logger.debug(`Published deleted directory info for: ${directoryPath}`);
        } catch (error) {
            this.logger.error(`Failed to publish deleted directory info for ${directoryPath}: ${error.message}`);
        }
    }

    async buildFileInfo(input: CommandExecInput): Promise<ItemInfo> {
        const { command, jobContext, targetPath, sourcePath, errorType } = input;
        const isDeleted = !!(command.ops?.[OPS_CMD.REMOVE_DIR] || command.ops?.[OPS_CMD.REMOVE_FILE]);
        if (isDeleted) {
            let sourceStats = null;
            try {
                sourceStats = await fs.promises.lstat(sourcePath);
            } catch (error) {
                this.logger.log(`[DELETE] Source path ${sourcePath} doesn't exist, using metadata from command`);
            }

            const sourceMeta: ItemMeta = sourceStats ? {
                accessTime: sourceStats.atime,
                birthTime: sourceStats.birthtime,
                modifiedTime: sourceStats.mtime,
                permission: getFilePermissions(sourceStats, sourceStats.isDirectory()),
                checksum : command.ops?.[OPS_CMD.COPY_FILE]?.params?.checksums?.sourceChecksum ?? '',
                uid: sourceStats.uid,
                gid: sourceStats.gid,
                sid: command.ops?.[OPS_CMD.STAMP_META]?.params?.sidMap?.sourceAcl ?? ''
            } : {
                accessTime: new Date(),
                birthTime: new Date(),
                modifiedTime: new Date(),
                permission: '',
                checksum: '',
                uid: 0,
                gid: 0,
                sid: ''
            };

            const isDirectory = command.ops?.[OPS_CMD.REMOVE_DIR] ? true : false;
            const itemInfo = new ItemInfo(
                command.fPath,
                isDirectory,
                false,
                command.fPath.split('/').length - 2,
                path.extname(targetPath),
                isDirectory ? FileType.DIRECTORY.toLowerCase() : FileType.FILE.toLowerCase(),
                sourceMeta,
                sourceMeta,
                0,
                command.metadata?.inode ?? 0,
                true,
                null // checksumTime is null for delete operations
            );
            (itemInfo as any).copyContentStatus = 'not_applicable';
            (itemInfo as any).stampMetaDataStatus = input.stampMetaDataStatus ?? 'not_applicable';

            return itemInfo;
        }

        // For copy operations, get both source and target stats
        const [sourceStats, targetStats] = await Promise.all([
            fs.promises.lstat(sourcePath),
            fs.promises.lstat(targetPath),
        ]);

        // Capture checksum timestamp - when the checksum was generated during file copy
        const checksumTime = command.ops?.[OPS_CMD.COPY_FILE]?.params?.checksumTime
            ? new Date(command.ops[OPS_CMD.COPY_FILE].params.checksumTime)
            : null;

        const sourceMeta: ItemMeta = {
            accessTime: sourceStats.atime,
            birthTime: sourceStats.birthtime,
            modifiedTime: sourceStats.mtime,
            permission: getFilePermissions(sourceStats, sourceStats.isDirectory()),
            checksum : command.ops?.[OPS_CMD.COPY_FILE]?.params?.checksums?.sourceChecksum ?? '',
            uid: sourceStats.uid,
            gid: sourceStats.gid,
            sid: command.ops?.[OPS_CMD.STAMP_META]?.params?.sidMap?.sourceAcl ?? ''
        }

        const isDirectory = targetStats.isDirectory();
        const targetMeta: ItemMeta = {
            accessTime: targetStats.atime,
            birthTime: targetStats.birthtime,
            modifiedTime: targetStats.mtime,
            permission: getFilePermissions(targetStats, isDirectory),
            checksum : command.ops?.[OPS_CMD.COPY_FILE]?.params?.checksums?.targetChecksum ?? '',
            uid: targetStats.uid,
            gid: targetStats.gid,
            sid: command.ops?.[OPS_CMD.STAMP_META]?.params?.sidMap?.targetAcl ?? ''
        }

        const itemInfo = new ItemInfo(
            command.fPath,
            isDirectory,
            targetStats.isSymbolicLink(),
            command.fPath.split('/').length - 2,
            path.extname(targetPath),
            getFileType(targetStats, isDirectory),
            sourceMeta,
            targetMeta,
            targetStats.size,
            command.metadata.inode,
            false, // isDeleted is false for copy operations
            checksumTime
        );
        (itemInfo as any).copyContentStatus = input.copyContentStatus ?? 'not_applicable';
        (itemInfo as any).stampMetaDataStatus = input.stampMetaDataStatus ?? 'not_applicable';
        const copyOp = command.ops?.[OPS_CMD.COPY_FILE] ?? command.ops?.[OPS_CMD.COPY_DIR] ?? command.ops?.[OPS_CMD.COPY_SYMLINK];
        const copyParams = copyOp?.params as { targetExisted?: boolean; checksums?: unknown } | undefined;
        const targetExisted = copyParams?.targetExisted === true;
        /**
         * - Real file copy sets checksums on COPY_FILE params → new vs content_updated from targetExisted.
         * - Metadata-only path: buildCommand marks COPY_FILE COMPLETED with no checksums (content matched; stamp only)
         *   → metadata_updated when target existed, not content_updated (recopy stats).
         * - Dirs/symlinks do not use checksums; keep targetExisted → content_updated | new.
         */
        if (command.ops?.[OPS_CMD.COPY_FILE]) {
            const hadContentCopy = copyParams?.checksums != null;
            if (hadContentCopy) {
                (itemInfo as any).updateType = targetExisted ? 'content_updated' : 'new';
            } else if (copyOp?.status === OPS_STATUS.COMPLETED) {
                (itemInfo as any).updateType = targetExisted ? 'metadata_updated' : 'new';
            } else {
                (itemInfo as any).updateType = targetExisted ? 'content_updated' : 'new';
            }
        } else {
            (itemInfo as any).updateType = targetExisted ? 'content_updated' : 'new';
        }

        await this.validateCommand({ cmd: command, item: itemInfo, jobContext, errorType,targetPath});
        return itemInfo;
    }

    async validateCommand({ cmd, item, jobContext, errorType, targetPath}:ValidateCommandInput): Promise<void> {
        let validateMisMatch : string = ""
        let shouldPreservePermissions = jobContext.jobConfig.options.preservePermissions

        if (!cmd.metadata?.isSymLink && item.sourceMeta.checksum !== item.targetMeta.checksum) 
            validateMisMatch += `CheckSum Mismatch detected, source: ${item.sourceMeta.checksum}, target: ${item.targetMeta.checksum} \n`;
        
        if (shouldPreservePermissions && !cmd.metadata?.isSymLink && item.sourceMeta.permission !== item.targetMeta.permission) 
            validateMisMatch += `Permission Mismatch detected, source: ${item.sourceMeta.permission}, target: ${item.targetMeta.permission} \n`;
        
        if (jobContext.jobConfig.options.preserveAccessTime &&  item.sourceMeta.accessTime.getTime() !== item.targetMeta.accessTime.getTime())
            validateMisMatch += `AccessTime Mismatch detected, source: ${item.sourceMeta.accessTime.toISOString()}, target: ${item.targetMeta.accessTime.toISOString()} \n`;

        if(shouldPreservePermissions && cmd.ops?.[OPS_CMD.STAMP_META]?.params?.error?.length) 
            validateMisMatch += `Stamping Errors Detected: ${cmd.ops?.[OPS_CMD.STAMP_META]?.params?.error} \n`;

        if(validateMisMatch.length > 0) {
            const error = new Error(validateMisMatch);
            const dmErr = dmError( "OPERATION",
                Origin.DESTINATION, Operation.STAMP_META,
                errorType, cmd.id, error, {name: cmd.fPath, path: targetPath});
            await jobContext.publishToErrorStream(dmErr, jobContext.jobConfig?.jobRunId);
        }
        
    }

}
