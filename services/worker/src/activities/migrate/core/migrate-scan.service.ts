import { Command, ErrorType, FileInfo, JobManagerContext, MetaData, OPS_CMD, OPS_STATUS, Task, TaskStatus } from "@netapp-cloud-datamigrate/jobs-lib";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { uuid4 } from "@temporalio/workflow";
import * as fs from "fs";
import * as path from "path";
import { basePrefix, dmError, getFileInfo, isContentUpdate, isSourceFatalError, removePrefix, shouldExcludeOrSkip } from "src/activities/utils/utils";
import { RedisService } from "src/redis/redis.service";
import { DirContentsInput, PublishCommandInput, ScanActivityInput, ScanActivityOutput, ScanDirectoryInput, ScanDirectoryOutput, ScanDirectorySettings, TaskExecResult, UpdateAndReportTaskInput } from './migrate-scan.type';
import { Context } from '@temporalio/activity';
import { CommonActivityService } from "src/activities/common/common.service";
import { Operation, Origin } from "src/activities/utils/utils.types";
import { FatalError, RetryableError, RetryExceededError } from "src/errors/errors.types";



const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

@Injectable()
export class MigrateScanService {
    readonly workerId: string;
    readonly maxMigrationCommand : number;
    readonly maxConcurrency: number;
    readonly maxRetryCount: number;

    constructor(
        @Inject(ConfigService) 
        private readonly configService: ConfigService,
        private readonly logger: Logger,
        private readonly redisService: RedisService,
        private readonly commonService: CommonActivityService,
    ) {
        this.workerId = this.configService.get<string>('worker.workerId');
        this.maxMigrationCommand = this.configService.get('worker.maxMigrationCommand') || 100;
        this.maxConcurrency = this.configService.get('worker.maxCommandConcurrency') || 100; 
        this.maxRetryCount = this.configService.get('worker.maxRetryCount') || 3;  
    }


    async publishCommands({ jobContext, commands}: PublishCommandInput)  {
        //TODO: make bulk publish to command stream. 
        for(const command of commands)
            await jobContext.publishToCommandStream(command);
    }

    async getDirContents({path, origin, jobContext, errorType, command}: DirContentsInput): Promise<Set<string>>{
        let content = new Set<string>();
        try{
            if (!fs.existsSync(path)) {
                if (origin === Origin.SOURCE)  
                    throw new FatalError(`Source directory does not exist: ${path}`);
                return content; 
            }
            content = new Set<string>( await fs.promises.readdir(path)); 
        }catch(error){
            if(error instanceof FatalError) 
                errorType = ErrorType.FATAL_ERROR;
            const ndmError = dmError("OPERATION", origin, Operation.READ_DIR, errorType, command.commandId, error, {name: command.fPath, path: path});
            await jobContext.publishToErrorStream(ndmError);
            throw error; 
        }
        return content;
    }

    async scanDirectory({ jobContext, sourcePath, sourcePrefix, targetPath , command, settings}: ScanDirectoryInput): Promise<ScanDirectoryOutput> { 

        const output: ScanDirectoryOutput = { fileCount: 0, dirCount: 0, subDirs: []}
        let commands: Command[] = [], errorType: ErrorType = command.retryCount+1 > this.maxRetryCount ? ErrorType.TRANSIENT_ERROR : ErrorType.RECOVERABLE_ERROR;

        const sourceContent = await this.getDirContents({path: sourcePath, origin: Origin.SOURCE, jobContext, errorType, command});
        const targetContent = await this.getDirContents({path: targetPath, origin: Origin.DESTINATION, jobContext, errorType, command});

        for (const item of sourceContent) {
            try {
                const sourceContentPath = path.join(sourcePath, item);
                if (!fs.existsSync(sourceContentPath)) continue;

                const sourceStat = await fs.promises.lstat(sourceContentPath);
                const relativeSourcePath = removePrefix(sourceContentPath, sourcePrefix);
                
                if (shouldExcludeOrSkip({
                    fullPath: sourceContentPath,
                    stats: sourceStat,
                    excludePatterns: settings.excludePatterns,
                    skipTime: settings.skipFile,
                    olderThan: new Date(jobContext.jobConfig.options?.excludeOlderThan),
                    jobType: jobContext.jobConfig.jobType
                })) continue;

                const fileInfo: FileInfo = await getFileInfo({name: item, fullFilePath: sourceContentPath, relativePath: relativeSourcePath});

                if (sourceStat.isDirectory() && !sourceStat.isSymbolicLink()) {
                    output.dirCount++;
                    output.subDirs.push(relativeSourcePath);
                    this.logger.debug(`Scan Path ${relativeSourcePath} | parent ${sourcePath}`)
                    if(!targetContent.has(item)) {
                        const command = this.buildCommand(sourceStat, fileInfo.path);
                        if (command) commands.push(command);
                    }
                } else if (!targetContent.has(item)) {
                    output.fileCount++;
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
                if(commands.length >= this.maxMigrationCommand) {
                    const chunk = commands.splice(0, this.maxMigrationCommand);
                    await this.publishCommands({ jobContext, commands: chunk });
                }
                
            }catch(error) {
                this.logger.error(`Error processing item ${item} in directory ${sourcePath}: ${error}`);
                const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.READ_DIR, errorType, command.commandId, error, {name: command.fPath, path: targetPath});
                await jobContext.publishToErrorStream(dmErr);
                throw error; 
            }
        }
        if (commands.length > 0) {
            await this.publishCommands({ jobContext, commands: commands });
            commands = [];
        }
        return output
    }

    async scanDirectories ({jobRunId, dirsToScan}: ScanActivityInput): Promise<ScanActivityOutput>  {
        const scanActivityContext = Context.current();
        const heartbeatInterval = setInterval(() => {
            scanActivityContext.heartbeat({});
        }, 2000);
        try{                           
            const jobContext: JobManagerContext = await this.redisService.getJobManagerContext(jobRunId);
            
            let task = await this.commonService.buildOrGetValidScanTask({
                dirToScans: dirsToScan,
                taskHashId: scanActivityContext.info.activityId,
                jobContext,
                jobRunId
            });

            task.status = TaskStatus.RUNNING;
            task.workerId = this.workerId;
            await jobContext.publishToTaskStream(task);

            let result: TaskExecResult = await this.executeTask(jobRunId, task, jobContext, scanActivityContext.info.activityId);
            const updateAndReportTaskInput: UpdateAndReportTaskInput = {
                errors: result.errors,
                jobContext,
                taskHashId: scanActivityContext.info.activityId,
                task,
                retryCount: result.retryCount
            }                        
            await this.updateAndReportTaskStatus(updateAndReportTaskInput)    
            return result.result;

        }catch(error){
            if(error instanceof FatalError || error instanceof RetryExceededError) 
                throw error;  
            //TODO: this is not requried we can just throw the error.isn't it ?     
            throw new RetryableError(error.message)
        }        
        finally{
            clearInterval(heartbeatInterval);
        }        
    }

    getScanSettings(jobContext: JobManagerContext ): ScanDirectorySettings {
        const settings: ScanDirectorySettings = {
            skipFile: jobContext.jobConfig.options?.skipsFilesModifiedInLast ?? '',
            excludePatterns: jobContext.jobConfig.options?.excludeFilePattern ? jobContext.jobConfig.options.excludeFilePattern.split(",") : []
        }
        return settings;
    }

    async executeTask(jobRunId:string, task:Task, jobContext: JobManagerContext, activityId:string): Promise<TaskExecResult>{
        const baseSourcePrefixPath = basePrefix(jobRunId, task.sPathId);
        const baseTargetPrefixPath = basePrefix(jobRunId, task.tPathId);
        const output: ScanActivityOutput = { dirCount: 0, fileCount: 0, subDirs: [], jobRunId: jobRunId }    
        let errors: string[] = [], retryCount: number = 0;        
        const settings = this.getScanSettings(jobContext);
        for (let i = 0; i < task.commands.length; i += this.maxConcurrency) {
            const batch = task.commands.slice(i, i + this.maxConcurrency);
            await Promise.allSettled(
                batch.map(async (command) => {
                    const scanDirectoryInput : ScanDirectoryInput = {
                        settings,
                        sourcePath: `${baseSourcePrefixPath}${command.fPath}`,
                        sourcePrefix: baseSourcePrefixPath,
                        targetPath: `${baseTargetPrefixPath}${command.fPath}`,
                        jobContext,
                        command
                    }
                    try {
                        const result = await this.scanDirectory(scanDirectoryInput);
                        output.fileCount += result.fileCount;
                        output.dirCount += result.dirCount;
                        output.subDirs.push(...result.subDirs);
                    }catch(error) {
                        errors.push(error.code ?? '')
                    }
                    command.retryCount++;
                    retryCount = Math.max(command.retryCount, retryCount);
                    jobContext.setTask(activityId, task)
                })
            )
        }
        return {result:output, errors, retryCount}
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

    async updateAndReportTaskStatus({ errors, jobContext, taskHashId, task, retryCount }: UpdateAndReportTaskInput) {
        if(errors.length == 0) {
            task.status = TaskStatus.COMPLETED
            await jobContext.publishToTaskStream(task);
            await jobContext.deleteTask(taskHashId);   
            return;
        }
        
        task.status = TaskStatus.ERRORED
        await jobContext.publishToTaskStream(task);
       
        if (errors.some(isSourceFatalError)) {
            await jobContext.deleteTask(taskHashId);
            throw new FatalError(`Sync Task Update Failed: ${errors.length} source errors with retry count ${retryCount} With Fatal Error`);
        }

        if (retryCount >= this.maxRetryCount) {
            await jobContext.deleteTask(taskHashId);
            throw new RetryExceededError(`Task ${task.id} has exceeded maximum retry count of ${this.maxRetryCount}`);
        }
        throw new RetryableError(`Sync Task Update Failed: ${errors.length} source errors with retry count ${retryCount} With Retryable Error`);
        
    }
}
