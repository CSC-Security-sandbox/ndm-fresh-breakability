import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Command, CommandStatus, ErrorType, FileInfo, JobContext, MetaData, OPS_CMD, OPS_STATUS, TaskStatus, TaskType } from "@netapp-cloud-datamigrate/jobs-lib";
import { uuid4 } from "@temporalio/workflow";
import * as fs from "fs";
import * as path from "path";
import { RedisService } from "src/redis/redis.service";

import { basePrefix, buildTask, dmError, getFileInfo, isFatalError, removePrefix, shouldExclude } from "../utils/utils";
import { ScanContentInput, ScanContentOutput, ScanPathInput, ScanPathOutput } from "./migrate.type";
import { Operation, Origin } from "../utils/utils.types";

@Injectable()
export class MigrationScanService {
    readonly workerId: string;
    readonly workerJobServiceUrl: string;
    readonly maxRetryCount: number = 3;

    constructor(
        @Inject(ConfigService) private readonly configService: ConfigService,
        private readonly logger: Logger,
        private readonly redisService: RedisService,
    ) {
        this.workerId = this.configService.get<string>('worker.workerId');
        this.maxRetryCount = this.configService.get('worker.maxRetryCount');
    }

    async getDirectoryContents(directoryPath: string): Promise<string[]> {
        if (!fs.existsSync(directoryPath)) 
            return [];
        return  await fs.promises.readdir(directoryPath);
    }

    async scanContent({ excludePatterns = [], jobContext, jobRunId, sourcePath, sourcePrefix, targetPath, command }: ScanContentInput): Promise<ScanContentOutput> {
        const syncContentOutput: ScanContentOutput = { files: 0, directory: 0, isGeneratedTask: false, error: undefined, errorType : command.retryCount >= this.maxRetryCount ? ErrorType.TRANSIENT_ERROR : ErrorType.RECOVERABLE_ERROR }
        let commands: Command[] = [], sourceContent: Set<string> =  new Set(), targetContent: Set<string> = new Set();

        try {
            sourceContent = new Set<string>(await this.getDirectoryContents(sourcePath));
        }catch(error) {
            const dmErr = dmError("OPERATION", Origin.SOURCE, Operation.READ_DIR, syncContentOutput.errorType, command.commandId, error, {name: command.fPath, path: sourcePath});
            await jobContext.appendToErrorList(dmErr);
            syncContentOutput.error = error?.code || '';
            return syncContentOutput;
        }

        try {
            targetContent = new Set<string>(await this.getDirectoryContents(targetPath));           
        }
        catch(error) {
            const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.READ_DIR, syncContentOutput.errorType, command.commandId, error, {name: command.fPath, path: targetPath});
            await jobContext.appendToErrorList(dmErr);
            syncContentOutput.error = error?.code || '';
            return syncContentOutput;
        }

        for (const item of sourceContent) {
            try {
                const sourceContentPath = path.join(sourcePath, item);
                if (!fs.existsSync(sourceContentPath)) continue;

                const sourceStat = await fs.promises.lstat(sourceContentPath);
                const relativeSourcePath = removePrefix(sourceContentPath, sourcePrefix);

                if (sourceStat.isSymbolicLink() || shouldExclude(sourceContentPath, excludePatterns))
                    continue;

                const fileInfo: FileInfo = await getFileInfo(item, sourceContentPath, relativeSourcePath);

                this.logger.debug(`Item : ${item}`);
                this.logger.debug(`sourceContentPath : ${sourceContentPath}`);
                this.logger.debug(`sourcePrefix : ${sourcePrefix}`);
                this.logger.debug(`relativeSourcePath : ${relativeSourcePath}`);

                if (sourceStat.isDirectory()) {
                    syncContentOutput.directory++;
                    const id = await jobContext.appendToDirList(fileInfo);
                    jobContext.dirsInfo.lastId = id;
                    jobContext.dirsInfo.numMessages++;
                    syncContentOutput.isGeneratedTask = true;
                    if(!targetContent.has(item)) {
                        const command = this.buildCommand(sourceStat, fileInfo.path);
                        if (command) commands.push(command);
                    }
                } else if (!targetContent.has(item)) {
                    syncContentOutput.files++;
                    const command = this.buildCommand(sourceStat, fileInfo.path);
                    if (command) commands.push(command);
                } else {
                    const targetFilePath = path.join(targetPath, item);
                    if (fs.existsSync(targetFilePath)) {
                        const targetStat = fs.statSync(targetFilePath);
                        const command = this.buildCommand(sourceStat, fileInfo.path, targetStat);
                        if (command) commands.push(command);
                    }
                }
            }catch(error) {
                const dmErr = dmError("OPERATION", Origin.SOURCE,  Operation.READ_DIR, syncContentOutput.errorType, command.commandId, error, {name: command.fPath, path: sourcePath});
                jobContext.errorsInfo.lastId = await jobContext.appendToErrorList(dmErr);
                syncContentOutput.error = error?.code || '';
            }
        }
        if (commands.length > 0) {
            const task = buildTask(TaskType.MIGRATE, jobRunId, jobContext, commands);
            jobContext.migrateTask.lastId  = await jobContext.appendToMigrationTask(task);
        }
        commands = [];
        return syncContentOutput;
    }

    async scanPath({ task }: ScanPathInput): Promise<ScanPathOutput> {
        const scanPath: ScanPathOutput = { isTaskCreated: false, errors: new Set<string>(), success: 0, error: 0, retryCount : 0 , isFatal: false};
        const jobContext: JobContext = await this.redisService.getJobContext(task.jobRunId);
        task.status = TaskStatus.RUNNING;
        task.commands.map((cmd: Command) => cmd.status = CommandStatus.IN_PROCESS);
        let id = await jobContext.appendToUpdatedTaskList(task);
        jobContext.updatedTaskInfo.lastId = id;
        await this.redisService.setJobContext(task.jobRunId, jobContext);

        for (let i = 0;  i < task.commands.length; i++) {
            if(task.commands[i].status === CommandStatus.COMPLETED) continue;
            const baseSourcePrefixPath = basePrefix(task.jobRunId, task.sPathId);
            const baseTargetPrefixPath = basePrefix(task.jobRunId, task.tPathId);
            const scanInput: ScanContentInput = {
                excludePatterns: task.excludeFilePatterns ? task.excludeFilePatterns.split(",") : [],
                sourcePath: `${baseSourcePrefixPath}${task.commands[i].fPath}`,
                sourcePrefix: baseSourcePrefixPath,
                targetPath: `${baseTargetPrefixPath}${task.commands[i].fPath}`,
                jobRunId: task.jobRunId,
                command: task.commands[i],
                jobContext
            };
            const result = await this.scanContent(scanInput);
            scanPath.retryCount = Math.max(task.commands[i].retryCount+1,  scanPath.retryCount)
            this.logger.log(`Result of scanContent: ${JSON.stringify(result)}`);
            if (result.isGeneratedTask) 
                scanPath.isTaskCreated = true;
            if (result.error)  
                task.commands[i].status = CommandStatus.ERROR, scanPath.errors.add(result.error), scanPath.error++;
            else  
                scanPath.success++, task.commands[i].status = CommandStatus.COMPLETED
        }      
        if(scanPath.error > 0 && scanPath.retryCount >= this.maxRetryCount)  
            task.status =  TaskStatus.ERRORED 
        else if( scanPath.retryCount > 0) 
            task.status = TaskStatus.COMPLETED_WITH_ERROR 
        else 
            task.status = TaskStatus.COMPLETED

        if( scanPath.error > 0) {
            for(const error of scanPath.errors)
                if(isFatalError(error)) {
                    scanPath.isFatal = true;
                    break;
                }
            const errorType = scanPath.isFatal ? ErrorType.FATAL_ERROR : scanPath.retryCount >= this.maxRetryCount ? ErrorType.TRANSIENT_ERROR : ErrorType.RECOVERABLE_ERROR;
            const dmErr = dmError("TASK", Origin.SOURCE, Operation.READ_DIR, errorType, task.id,  undefined, undefined, {
                errorCode: scanPath.errors.size > 0 ? Array.from(scanPath.errors) : [], 
                message: `Task ${task.id} has ${scanPath.error} errors and ${scanPath.success} success during scan`
            });
            await jobContext.appendToErrorList(dmErr);
            if(scanPath.retryCount < this.maxRetryCount) 
                jobContext.migrateTask.lastId = await jobContext.appendToTaskList(task);
        }
        else {
            jobContext.updatedTaskInfo.lastId = await jobContext.appendToUpdatedTaskList(task);
        }

     
        await this.redisService.setJobContext(task.jobRunId, jobContext);
        return scanPath;
    }

    buildCommand = (sFile: fs.Stats, fPath: string, dFile?: fs.Stats): Command | undefined => {
        if (!dFile || (sFile.size !== dFile.size) || (sFile.mtime.toISOString() !== dFile.mtime.toISOString())) {
            const metadata: MetaData =  { 
                size: sFile.size,
                mtime: sFile.mtime,
                mode: sFile.mode,
                uid: sFile.uid,
                gid: sFile.gid,
                atime: sFile.atime,
                ctime: sFile.ctime,
                birthtime: sFile.birthtime,
            } 
            return new Command(
                fPath,
                {
                    0: { cmd: sFile.isDirectory() ? OPS_CMD.COPY_DIR:  OPS_CMD.COPY_CONTENT, status: OPS_STATUS.READY },
                    1: { cmd: OPS_CMD.STAMP_META, status: OPS_STATUS.READY, metadata}
                },
                uuid4(),
                0
            );
        }
        return undefined;
    }
}
