
import { CommandStatus, ItemInfo, ItemMeta, OPS_CMD, OPS_STATUS } from "@netapp-cloud-datamigrate/jobs-lib";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LoggerFactory, LoggerService } from "@netapp-cloud-datamigrate/logger-lib";
import * as fs from "fs";
import * as path from 'path';
import { dmError, getFilePermissions, getFileType } from "src/activities/utils/utils";
import { Operation, Origin } from "src/activities/utils/utils.types";
import { WorkerThreadService } from "src/thread/worker.thread.service";
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
    ) {
        this.workerId = this.configService?.get<string>('worker.workerId') ?? '';
        this.logger = loggerFactory.create(CommandExecService.name);
    }
    async executeCommand(input: CommandExecInput): Promise<CommandExecOutput> {

        const output: CommandExecOutput = { sourceErrors: [], targetErrors: [], cmd: input.command };
        let baseCmdRes: CommandOutput = { shouldStampMeta: false, shouldUpdateItemInfo: false, sourceErrors: [], targetErrors: [] };

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
        if (baseCmdRes.shouldStampMeta) {
            const metaResult = await this.stampMetaService.stampMetaData(input);
            baseCmdRes.shouldUpdateItemInfo = metaResult.shouldUpdateItemInfo;
            output.targetErrors.push(...metaResult.targetErrors);
            output.sourceErrors.push(...metaResult.sourceErrors);
        }
        if( baseCmdRes.shouldUpdateItemInfo ) {
            await this.publishFileInfo(input);
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
            let linkTarget = await fs.promises.readlink(sourcePath);
            this.logger.debug(`Read symlink: ${sourcePath} -> ${linkTarget}`);
            
            // If linkTarget is absolute, we need to convert it to relative or adjust it for destination
            // This handles the case where Windows symlinks have absolute paths like D:\Shares\...
            if (path.isAbsolute(linkTarget)) {
                this.logger.debug(`Symlink target is absolute: ${linkTarget}, converting to relative path`);
                // Convert absolute source path to relative from the symlink location
                linkTarget = path.relative(path.dirname(sourcePath), linkTarget);
                this.logger.debug(`Converted to relative path: ${linkTarget}`);
            }
            
            // Ensure parent directory exists before creating symlink
            const parentDir = path.dirname(targetPath);
            try {
                await fs.promises.mkdir(parentDir, { recursive: true });
                this.logger.log(`Ensured parent directory exists: ${parentDir}`);
            } catch (mkdirErr) {
                this.logger.warn(`Could not create parent directory ${parentDir}: ${mkdirErr.message}`);
            }
            
            // Check if something already exists at targetPath and remove it if necessary
            try {
                const targetStats = await fs.promises.lstat(targetPath);
                if (targetStats.isSymbolicLink()) {
                    // Already a symlink - check if it's correct
                    const existingTarget = await fs.promises.readlink(targetPath);
                    if (existingTarget === linkTarget) {
                        this.logger.debug(`Symlink already exists with correct target: ${targetPath} -> ${linkTarget}`);
                        command.ops[OPS_CMD.COPY_SYMLINK] = { status: OPS_STATUS.COMPLETED, params: { linkTarget } };
                        output.shouldStampMeta = true;
                        output.shouldUpdateItemInfo = true;
                        return output;
                    } else {
                        this.logger.warn(`Symlink exists but points to wrong target. Existing: ${existingTarget}, Expected: ${linkTarget}. Removing...`);
                        await fs.promises.unlink(targetPath);
                    }
                } else if (targetStats.isDirectory()) {
                    this.logger.warn(`Directory exists at symlink location: ${targetPath}. Removing to create symlink...`);
                    await fs.promises.rm(targetPath, { recursive: true, force: true });
                } else {
                    this.logger.warn(`File exists at symlink location: ${targetPath}. Removing to create symlink...`);
                    await fs.promises.unlink(targetPath);
                }
            } catch (checkErr) {
                if (checkErr.code !== 'ENOENT') {
                    this.logger.debug(`Could not check/remove existing item at ${targetPath}: ${checkErr.message}`);
                }
                // ENOENT is expected - nothing exists yet, which is good
            }
            
            // Create the symbolic link
            // On Windows, we need to specify the type parameter
            if (process.platform === 'win32') {
                // Determine if the symlink points to a directory or file
                let symlinkType: 'file' | 'dir' | 'junction' = 'file';
                
                // Check what the source symlink actually points to
                // Use stat() on the source symlink itself (not its target path) to follow it
                this.logger.log(`Checking source symlink target by following: ${sourcePath}`);
                
                try {
                    // Use stat (not lstat) on the SOURCE SYMLINK to follow it and see what type it ultimately points to
                    // This works because sourcePath is already the symlink we're copying
                    const sourceTargetStats = await fs.promises.stat(sourcePath);
                    symlinkType = sourceTargetStats.isDirectory() ? 'dir' : 'file';
                    this.logger.log(`Source symlink points to ${sourceTargetStats.isDirectory() ? 'directory' : 'file'}, using symlink type: ${symlinkType}`);
                } catch (srcErr) {
                    // Source target doesn't exist or can't be accessed
                    this.logger.log(`Could not stat source symlink target (${srcErr.message}), defaulting to 'file' type`);
                }
                
                this.logger.log(`Creating Windows symlink: ${targetPath} -> ${linkTarget} with type=${symlinkType}`);
                
                // Create the symlink (conflicts already handled above)
                await fs.promises.symlink(linkTarget, targetPath, symlinkType);
                this.logger.debug(`Successfully created Windows symbolic link (${symlinkType}): ${targetPath} -> ${linkTarget}`);
            } else {
                // Unix/Linux doesn't require the type parameter
                await fs.promises.symlink(linkTarget, targetPath);
                this.logger.debug(`Created symbolic link: ${targetPath} -> ${linkTarget}`);
            }
            
            // Mark operation as completed
            command.ops[OPS_CMD.COPY_SYMLINK] = { status: OPS_STATUS.COMPLETED, params: { linkTarget } };
            
            output.shouldStampMeta = true;
            output.shouldUpdateItemInfo = true;
        } catch (error) {
            command.ops[OPS_CMD.COPY_SYMLINK] = { ...command.ops[OPS_CMD.COPY_SYMLINK], status: OPS_STATUS.ERROR };
            this.logger.error(`Copying SYMLINK from ${sourcePath} to ${targetPath}, Error: ${error.message}`, error.stack);
            const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.COPY_CONTENT, errorType, command.id, error, {name: command.fPath, path: targetPath});
            await jobContext.publishToErrorStream(dmErr);
            output.targetErrors.push(error.code);
        }        
    return output;
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
                await jobContext.publishToErrorStream(dmErr);
                output.sourceErrors.push('ENOENT');
                return output
            }
            try {
                if(targetPathExists)
                    await this.stampMetaService.resetFileAttributes(targetPath);

                // TODO: 
                const checksums = await this.workerThreadService.migrateWorkerThread({ sourcePath, destinationPath: targetPath, operationId: command.id, size: command.metadata?.size ?? 0
                });


                output.shouldUpdateItemInfo = true;
                if(checksums?.targetChecksum !== checksums?.sourceChecksum) {
                    command.ops[OPS_CMD.COPY_FILE] = {  status: OPS_STATUS.ERROR, params : { checksums } };
                    throw new Error(`Checksum mismatch detected, source: ${checksums?.sourceChecksum}, target: ${checksums?.targetChecksum}`);
                }
                command.ops[OPS_CMD.COPY_FILE] = {  status: OPS_STATUS.COMPLETED, params : { checksums } };
                output.shouldStampMeta = true;
            }catch(error){
                command.ops[OPS_CMD.COPY_FILE] = {  ... command.ops[OPS_CMD.COPY_FILE], status: OPS_STATUS.ERROR }; 
                this.logger.error(`Copying FILE from ${sourcePath} to ${targetPath}, Error: ${error.message}`, error.stack);
                const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.COPY_CONTENT, errorType, command.id, error, {name: command.fPath, path: targetPath});
                await jobContext.publishToErrorStream(dmErr);   
                output.targetErrors.push(error.code);
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
                await fs.promises.mkdir(targetPath, {recursive: true});                
                command.ops[OPS_CMD.COPY_DIR].status = OPS_STATUS.COMPLETED;
                output.shouldStampMeta = true;
                output.shouldUpdateItemInfo = true;
            } catch (error) {
                command.ops[OPS_CMD.COPY_DIR].status = OPS_STATUS.ERROR;
                this.logger.error(`Copying DIR from ${sourcePath} to ${targetPath}, Error: ${error.message}`, error.stack);
                const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.COPY_CONTENT, errorType, command.id, error, {name: command.fPath, path: targetPath});
                await jobContext.publishToErrorStream(dmErr);
                output.targetErrors.push(error.code);
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
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    command.ops[OPS_CMD.REMOVE_FILE].status = OPS_STATUS.ERROR;
                    this.logger.error(`Deleting FILE from  ${targetPath}, Error: ${error.message}`, error.stack);
                    const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.COPY_CONTENT, errorType, command.id, error, {name: command.fPath, path: targetPath});
                    await jobContext.publishToErrorStream(dmErr);
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
                command.ops[OPS_CMD.REMOVE_DIR].status = OPS_STATUS.COMPLETED;
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    command.ops[OPS_CMD.REMOVE_DIR].status = OPS_STATUS.ERROR;
                    this.logger.error(`Deleting DIR from  ${targetPath}, Error: ${error.message}`, error.stack);
                    const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.COPY_CONTENT, errorType, command.id, error, {name: command.fPath, path: targetPath});
                    await jobContext.publishToErrorStream(dmErr);
                    output.sourceErrors.push(error.code);
                }
            }
        }
        return output
    }

    async publishFileInfo({command , jobContext, targetPath, sourcePath, errorType  }: CommandExecInput): Promise<void> {
        // TODO: add sid - uid - gid to meta
        const [sourceStats, targetStats] = await Promise.all([
            fs.promises.lstat(sourcePath),
            fs.promises.lstat(targetPath),
        ]);

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
            command.metadata.inode
        )

        await this.validateCommand({ cmd: command, item: itemInfo, jobContext, errorType});
        await jobContext.publishToFileStream(itemInfo);
    }

    async validateCommand({ cmd, item, jobContext, errorType}:ValidateCommandInput): Promise<void> {
        let validateMisMatch : string = ""

        if (!cmd.metadata?.isSymLink && item.sourceMeta.checksum !== item.targetMeta.checksum) 
            validateMisMatch += `CheckSum Mismatch detected, source: ${item.sourceMeta.checksum}, target: ${item.targetMeta.checksum} \n`;
        
        if (!cmd.metadata?.isSymLink && item.sourceMeta.permission !== item.targetMeta.permission) 
            validateMisMatch += `Permission Mismatch detected, source: ${item.sourceMeta.permission}, target: ${item.targetMeta.permission} \n`;
        
        if (jobContext.jobConfig.options.preserveAccessTime &&  item.sourceMeta.accessTime.getTime() !== item.targetMeta.accessTime.getTime())
            validateMisMatch += `AccessTime Mismatch detected, source: ${item.sourceMeta.accessTime.toISOString()}, target: ${item.targetMeta.accessTime.toISOString()} \n`;

        if(cmd.ops?.[OPS_CMD.STAMP_META]?.params?.error?.length) 
            validateMisMatch += `Stamping Errors Detected: ${cmd.ops?.[OPS_CMD.STAMP_META]?.params?.error} \n`;

        if(validateMisMatch.length > 0) {
            const error = new Error(validateMisMatch);
            const dmErr = dmError( "OPERATION",
                Origin.DESTINATION, Operation.STAMP_META,
                errorType, cmd.id, error, {name: cmd.fPath, path: item.fileName});
            await jobContext.publishToErrorStream(dmErr);
        }
        
    }

}
