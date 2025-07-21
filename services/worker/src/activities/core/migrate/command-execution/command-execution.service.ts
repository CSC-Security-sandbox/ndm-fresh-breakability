
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ItemInfo, ItemMeta, OPS_CMD, OPS_STATUS } from "@netapp-cloud-datamigrate/jobs-lib";

import * as fs from "fs";
import * as path from 'path';
import { dmError, getFilePermissions, getFileType } from "src/activities/utils/utils";
import { Operation, Origin } from "src/activities/utils/utils.types";
import { WorkerThreadService } from "src/thread/worker.thread.service";
import { CommandExecInput, CommandExecOutput, CommandOutput } from "./command-execution.type";
import { StampMetaService } from "./stamp-meta.service";

@Injectable()
export class CommandExecService {
    readonly workerId: string;

    constructor(
        @Inject(ConfigService) private readonly configService: ConfigService,
        private readonly logger: Logger,
        private readonly workerThreadService: WorkerThreadService,
        private readonly stampMetaService: StampMetaService
    ) {
        this.workerId = this.configService?.get<string>('worker.workerId') ?? '';
    }
    async executeCommand(input: CommandExecInput): Promise<CommandExecOutput> {
        let shouldStampMeta = false;
        const sourceErrors: string[] = [];
        const targetErrors: string[] = [];

        // Copy File
        const copyFileResult = await this.copyFile(input);
        sourceErrors.push(...copyFileResult.sourceErrors);
        targetErrors.push(...copyFileResult.targetErrors);
        shouldStampMeta ||= copyFileResult.shouldStampMeta;

        // Copy Directory
        const copyDirResult = await this.copyDirectory(input);
        sourceErrors.push(...copyDirResult.sourceErrors);
        targetErrors.push(...copyDirResult.targetErrors);
        shouldStampMeta ||= copyDirResult.shouldStampMeta;

        // Delete File
        const deleteFileResult = await this.deleteFile(input);
        sourceErrors.push(...deleteFileResult.sourceErrors);
        targetErrors.push(...deleteFileResult.targetErrors);
        shouldStampMeta ||= deleteFileResult.shouldStampMeta;

        // Delete Directory
        const deleteDirResult = await this.deleteDirectory(input);
        sourceErrors.push(...deleteDirResult.sourceErrors);
        targetErrors.push(...deleteDirResult.targetErrors);
        shouldStampMeta ||= deleteDirResult.shouldStampMeta;

        // Stamp Meta if needed
        if (shouldStampMeta) {
            const metaResult = await this.stampMetaService.stampMetaData(input);
            sourceErrors.push(...metaResult.sourceErrors);
            targetErrors.push(...metaResult.targetErrors);
            await this.publishFileInfo(input);
        }
        return { sourceErrors, targetErrors, cmd: input.command }  ;
    }


    async copyFile({command , jobContext, sourcePath, targetPath, errorType }: CommandExecInput): Promise<CommandOutput> {
        const output: CommandOutput = { shouldStampMeta: false, sourceErrors: [], targetErrors: [] };
        if(command.ops && command.ops[OPS_CMD.COPY_FILE] && command.ops[OPS_CMD.COPY_FILE].status !== OPS_STATUS.COMPLETED) {
            if(!fs.existsSync(sourcePath)) {
                const dmErr = dmError("OPERATION", Origin.SOURCE, Operation.COPY_CONTENT, errorType, command.id, new Error(`Source path does not exist: ${sourcePath}`), {name: command.fPath, path: sourcePath});
                await jobContext.publishToErrorStream(dmErr);
            }
            try {
                const checksums = await this.workerThreadService.migrateWorkerThread({
                    sourcePath, destinationPath: targetPath, operationId: command.id, size: command.metadata?.size ?? 0
                });
                command.ops[OPS_CMD.COPY_FILE] = {  status: OPS_STATUS.COMPLETED, params : { checksums } };
                output.shouldStampMeta = true;
            }catch(error){
                command.ops[OPS_CMD.COPY_FILE] = {  status: OPS_STATUS.ERROR, params : {  } };
                this.logger.error(`Copying FILE from ${sourcePath} to ${targetPath}, Error: ${error.message}`, error.stack);
                const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.COPY_CONTENT, errorType, command.id, error, {name: command.fPath, path: targetPath});
                await jobContext.publishToErrorStream(dmErr);   
                output.targetErrors.push(error.code);
            }
        }
        return output;
    }

    async copyDirectory({command, jobContext, sourcePath, targetPath, errorType }: CommandExecInput): Promise<CommandOutput> {
        const output: CommandOutput = { shouldStampMeta: false, sourceErrors: [], targetErrors: [] };
        if(command.ops && command.ops[OPS_CMD.COPY_DIR] && command.ops[OPS_CMD.COPY_DIR].status !== OPS_STATUS.COMPLETED) {
            try {
                fs.mkdirSync(targetPath, { recursive: true });  
                command.ops[OPS_CMD.COPY_FILE].status = OPS_STATUS.COMPLETED;
                output.shouldStampMeta = true;
            } catch (error) {
                this.logger.debug(`Command : ${JSON.stringify(command)}`);
                command.ops[OPS_CMD.COPY_FILE].status = OPS_STATUS.ERROR;
                this.logger.error(`Copying DIR from ${sourcePath} to ${targetPath}, Error: ${error.message}`, error.stack);
                const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.COPY_CONTENT, errorType, command.id, error, {name: command.fPath, path: targetPath});
                await jobContext.publishToErrorStream(dmErr);
                output.targetErrors.push(error.code);
            }
        }
        return output
    }

    async deleteFile({command , jobContext, targetPath, errorType }: CommandExecInput): Promise<CommandOutput> {
        const output: CommandOutput = { shouldStampMeta: false, sourceErrors: [], targetErrors: [] };
        if(command.ops && command.ops[OPS_CMD.REMOVE_FILE] && command.ops[OPS_CMD.REMOVE_FILE].status !== OPS_STATUS.COMPLETED) {
            try {
                await fs.promises.unlink(targetPath);
                command.ops[OPS_CMD.REMOVE_FILE].status = OPS_STATUS.COMPLETED;
                output.shouldStampMeta = true;
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
        const output: CommandOutput = { shouldStampMeta: false, sourceErrors: [], targetErrors: [] };
        if(command.ops && command.ops[OPS_CMD.REMOVE_DIR] && command.ops[OPS_CMD.REMOVE_DIR].status !== OPS_STATUS.COMPLETED) {
            try {
                await fs.promises.rm(targetPath, { recursive: true, force: true });
                command.ops[OPS_CMD.REMOVE_DIR].status = OPS_STATUS.COMPLETED;
                output.shouldStampMeta = true;
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

    async publishFileInfo({command , jobContext, targetPath, sourcePath  }: CommandExecInput): Promise<void> {
        // TODO: add sid - uid - gid to meta
        const sourceStats = await fs.promises.lstat(sourcePath);
        const sourceMeta: ItemMeta = {
            accessTime: sourceStats.atime,
            birthTime: sourceStats.birthtime,
            modifiedTime: sourceStats.mtime,
            permission: getFilePermissions(sourceStats, sourceStats.isDirectory()),
            checksum : command.ops?.[OPS_CMD.COPY_FILE]?.params?.checksums?.sourceChecksum ?? '',
            uid: sourceStats.uid,
            gid: sourceStats.gid,
        }

        const targetStats = await fs.promises.lstat(targetPath);
        const targetMeta: ItemMeta = {
            accessTime: targetStats.atime,
            birthTime: targetStats.birthtime,
            modifiedTime: targetStats.mtime,
            permission: getFilePermissions(targetStats, targetStats.isDirectory()),
            checksum : command.ops?.[OPS_CMD.COPY_FILE]?.params?.checksums?.targetChecksum ?? '',
            uid: targetStats.uid,
            gid: targetStats.gid,
        }

        const itemInfo = new ItemInfo(
            command.fPath,
            targetStats.isDirectory(),
            targetStats.isSymbolicLink(),
            command.fPath.split('/').length - 2,
            path.extname(sourcePath),
            getFileType(targetStats, targetStats.isDirectory()),
            sourceMeta,
            targetMeta,
            targetStats.size
        )

        await jobContext.publishToFileStream(itemInfo);
    }

}