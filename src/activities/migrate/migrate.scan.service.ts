import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Command, CommandStatus, ErrorType, FileInfo, JobContext, MetaData, OPS_CMD, OPS_STATUS, TaskStatus, TaskType } from "@netapp-cloud-datamigrate/jobs-lib";
import { uuid4 } from "@temporalio/workflow";
import * as fs from "fs";
import * as path from "path";
import { RedisService } from "src/redis/redis.service";
import { CommonActivityService } from "../common/common.service";
import { basePrefix, buildTask, dmError, getFileInfo, isContentUpdate, isFatalError, removePrefix, shouldExcludeOrSkip } from "../utils/utils";
import { Operation, Origin } from "../utils/utils.types";
import { PublishMigrationTaskInput, ScanContentInput, ScanContentOutput, ScanPathInput, ScanPathOutput } from "./migrate.type";
import { Context } from '@temporalio/activity';


@Injectable()
export class MigrationScanService {
    readonly workerId: string;
    readonly maxRetryCount: number = 3;
    readonly maxMigrationCommand : number = 1000;
    readonly maxConcurrency: number = 10;
    constructor(
        @Inject(ConfigService) private readonly configService: ConfigService,
        private readonly logger: Logger,
        private readonly redisService: RedisService,
        private readonly commonService: CommonActivityService
    ) {
        this.workerId = this.configService.get<string>('worker.workerId');
        this.maxRetryCount = this.configService.get('worker.maxRetryCount');
        this.maxMigrationCommand = this.configService.get('worker.maxMigrationCommand');
        this.maxConcurrency = this.configService.get('worker.maxConcurrency') || 100;   
    }

    async getDirectoryContents(directoryPath: string): Promise<string[]> {
        if (!fs.existsSync(directoryPath)) 
            return [];
        return  await fs.promises.readdir(directoryPath);
    }

    async publishMigrationTask({ jobContext, commands}: PublishMigrationTaskInput)  {
        const task = buildTask(TaskType.MIGRATE, jobContext.jobRunId, jobContext, commands);
        jobContext.migrateTask.lastId  = await jobContext.appendToMigrationTask(task);
        this.logger.debug(`[${jobContext.jobRunId}] Task published: ${task?.id} | stats : ${task?.status} | command : ${task?.commands?.length}`);
    }

    async scanContent({ excludePatterns = [], jobContext, sourcePath, sourcePrefix, targetPath, command, skipFile }: ScanContentInput): Promise<ScanContentOutput> {
        const syncContentOutput: ScanContentOutput = {
             files: 0, directory: 0, isGeneratedTask: false, error: undefined, command : []
            }
        let sourceContent: Set<string> =  new Set(), targetContent: Set<string> = new Set(), errorType = command.retryCount >= this.maxRetryCount ? ErrorType.TRANSIENT_ERROR : ErrorType.RECOVERABLE_ERROR ;
        
        try {
            sourceContent = new Set<string>(await this.getDirectoryContents(sourcePath));
        }catch(error) {
            const dmErr = dmError("OPERATION", Origin.SOURCE, Operation.READ_DIR, errorType, command.commandId, error, {name: command.fPath, path: sourcePath});
            await jobContext.appendToErrorList(dmErr);
            syncContentOutput.error = error?.code || '';
            return syncContentOutput;
        }

        try {
            targetContent = new Set<string>(await this.getDirectoryContents(targetPath));           
        }
        catch(error) {
            const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.READ_DIR, errorType, command.commandId, error, {name: command.fPath, path: targetPath});
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
                
                if (shouldExcludeOrSkip({
                    fullPath: sourceContentPath,
                    stats: sourceStat,
                    excludePatterns,
                    skipTime: skipFile,
                    olderThan: new Date(jobContext.jobConfig.options?.excludeOlderThan),
                    jobType: jobContext.jobConfig.jobType
                })) continue;

                const fileInfo: FileInfo = await getFileInfo({name: item, fullFilePath: sourceContentPath, relativePath: relativeSourcePath});

                if (sourceStat.isDirectory() && !sourceStat.isSymbolicLink()) {
                    syncContentOutput.directory++;
                    const id = await jobContext.appendToDirList(fileInfo);
                    jobContext.dirsInfo.lastId = id;
                    jobContext.dirsInfo.numMessages++;
                    syncContentOutput.isGeneratedTask = true;
                    if(!targetContent.has(item)) {
                        const command = this.buildCommand(sourceStat, fileInfo.path);
                        if (command) syncContentOutput.command.push(command);
                    }
                } else if (!targetContent.has(item)) {
                    syncContentOutput.files++;
                    const command = this.buildCommand(sourceStat, fileInfo.path);
                    if (command) syncContentOutput.command.push(command);
                } else {
                    const targetFilePath = path.join(targetPath, item);
                    if (fs.existsSync(targetFilePath)) {
                        const targetStat = fs.statSync(targetFilePath);
                        const command = this.buildCommand(sourceStat, fileInfo.path, targetStat);
                        if (command) syncContentOutput.command.push(command);
                    }
                }
                if(syncContentOutput.command.length >= this.maxMigrationCommand) {
                    const chunk = syncContentOutput.command.splice(0, this.maxMigrationCommand);
                    await this.publishMigrationTask({ jobContext, commands: chunk });
                }
            }catch(error) {
                const dmErr = dmError("OPERATION", Origin.SOURCE,  Operation.READ_DIR, syncContentOutput.errorType, command.commandId, error, {name: command.fPath, path: sourcePath});
                jobContext.errorsInfo.lastId = await jobContext.appendToErrorList(dmErr);
                syncContentOutput.error = error?.code || '';
            }
        }
        return syncContentOutput;
    }

    async scanPathActivity({ jobRunId, failedWorkers }: ScanPathInput): Promise<ScanPathOutput> {
        const scanPath: ScanPathOutput = { workerId: this.workerId, isTaskCreated: false, errors: new Set<string>(), success: 0, error: 0, retryCount : 0 , isFatal: false, noTaskFound: false, files: 0, folders: 0 };
        const jobContext: JobContext = await this.redisService.getJobContext(jobRunId);
        if(failedWorkers.includes(this.workerId)) {
            scanPath.isFatal = true;
            scanPath.noTaskFound = true;
            this.logger.debug(`[${jobRunId}] Worker already failed => ${this.workerId}`);
            return scanPath
        }
        let task = await jobContext.getScanTask(this.workerId);
        if(!task) task = await this.commonService.fetchOneTask(jobContext);
       
        if(!task) {
            scanPath.noTaskFound = true;
            this.logger.debug(`[${jobRunId}] No task found`);
            return scanPath;
        }
        await jobContext.setScanTask(this.workerId, task);

        this.logger.debug(`[${jobRunId}] Found Task => ${task?.id} | stats : ${task?.status} | command : ${task?.commands?.length}`);

        const commands :Command[] = []
      
        task.workerId = this.workerId;
        task.status = TaskStatus.RUNNING;
        for (let i = 0;  i < task.commands.length; i++) 
            if(task.commands[i].status !== CommandStatus.COMPLETED)
                task.commands[i].status = CommandStatus.IN_PROCESS
        
        this.logger.debug(`[${jobRunId}] Running Task => ${task?.id} | stats : ${task?.status} | command : ${task?.commands?.length}`);
      
        jobContext.updatedTaskInfo.lastId  = await jobContext.appendToUpdatedTaskList(task);
        await this.redisService.setJobContext(task.jobRunId, jobContext);

        const baseSourcePrefixPath = basePrefix(task.jobRunId, task.sPathId);
        const baseTargetPrefixPath = basePrefix(task.jobRunId, task.tPathId);
        const excludePatterns = jobContext.jobConfig.options?.excludeFilePattern ? jobContext.jobConfig.options.excludeFilePattern.split(",") : [];
        const skipFile = jobContext.jobConfig.options?.skipsFilesModifiedInLast ? jobContext.jobConfig.options.skipsFilesModifiedInLast : '';
     
        for (let i = 0; i < task.commands.length; i += this.maxConcurrency) {
            const batch = task.commands.slice(i, i + this.maxConcurrency);
        
            await Promise.allSettled(
                batch.map(async (command) => {
                    if (command.status === CommandStatus.COMPLETED) return;
        
                    const scanInput: ScanContentInput = {
                        excludePatterns,
                        sourcePath: `${baseSourcePrefixPath}${command.fPath}`,
                        sourcePrefix: baseSourcePrefixPath,
                        targetPath: `${baseTargetPrefixPath}${command.fPath}`,
                        jobRunId: task.jobRunId,
                        command,
                        jobContext,
                        skipFile
                    };
        
                    const result = await this.scanContent(scanInput);
        
                    scanPath.files += result.files;
                    scanPath.folders += result.directory;
        
                    commands.push(...result.command);
                    if (commands.length >= this.maxMigrationCommand) {
                        const chunk = commands.splice(0, this.maxMigrationCommand);
                        await this.publishMigrationTask({ jobContext, commands: chunk });
                    }
        
                    if (result.isGeneratedTask) {
                        scanPath.isTaskCreated = true;
                    }
        
                    if (result.error) {
                        command.retryCount++;
                        command.status = CommandStatus.ERROR;
                        scanPath.errors.add(result.error);
                        scanPath.error++;
                    } else {
                        scanPath.success++;
                        command.status = CommandStatus.COMPLETED;
                        await jobContext.setScanTask(this.workerId, task);
                    }
                    scanPath.retryCount = Math.max(command.retryCount, scanPath.retryCount);
                })
            );
        }
        
        if(commands.length > 0) {
            const chunk = commands.splice(0, this.maxMigrationCommand);
            await this.publishMigrationTask({ jobContext, commands: chunk });
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
            if(errorType===ErrorType.TRANSIENT_ERROR || errorType===ErrorType.FATAL_ERROR)
                task.status = TaskStatus.ERRORED;
            if(scanPath.retryCount < this.maxRetryCount && !scanPath.isFatal)  {
                this.logger.debug(`[${jobRunId}] Appending to Retry => ${task?.id} | stats : ${task?.status} | command : ${task?.commands?.length}`);
                jobContext.tasksInfo.lastId= await jobContext.appendToTaskList(task);
            } else if(scanPath.isFatal){
                this.logger.debug(`[${jobRunId}] Fatal Error Detected for task => ${task?.id} | stats : ${task?.status} | command : ${task?.commands?.length} `)
                jobContext.updatedTaskInfo.lastId = await jobContext.appendToUpdatedTaskList(task);
            }
        }
        else {
            this.logger.debug(`[${jobRunId}] Completed Task => ${task?.id} | stats : ${task?.status} | command : ${task?.commands?.length}`);
            jobContext.updatedTaskInfo.lastId = await jobContext.appendToUpdatedTaskList(task);
        }
        await this.redisService.setJobContext(task.jobRunId, jobContext);
        await jobContext.deleteScanTask(this.workerId);
        return scanPath;
    }

    buildCommand = (sFile: fs.Stats, fPath: string, dFile?: fs.Stats): Command | undefined => {
        const metadata: MetaData =  { 
            size: sFile.size,
            mtime: sFile.mtime,
            mode: sFile.mode,
            uid: sFile.uid,
            gid: sFile.gid,
            atime: sFile.atime,
            ctime: sFile.ctime,
            birthtime: sFile.birthtime,
            sid: undefined
        } 
        if (isContentUpdate(sFile, dFile) ) 
            return new Command(
                fPath,
                {
                    0: { cmd: sFile.isDirectory() ? OPS_CMD.COPY_DIR:  OPS_CMD.COPY_CONTENT, status: OPS_STATUS.READY },
                    1: { cmd: OPS_CMD.STAMP_META, status: OPS_STATUS.READY, metadata}
                },
                uuid4(),
                0
            );

        return undefined;
    }

    async scanPath({ jobRunId, failedWorkers }: ScanPathInput): Promise<ScanPathOutput> {
        const ctx = Context.current();
        const interval = setInterval(() => { ctx.heartbeat({ workerId: this.workerId }) }, 10000);
        try {
            return this.scanPathActivity({ jobRunId, failedWorkers });
        } finally {
            clearInterval(interval);
        }
    }
}
