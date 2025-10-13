import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ErrorType, JobManagerContext, TaskStatus } from "@netapp-cloud-datamigrate/jobs-lib";
import { Context } from '@temporalio/activity';
import { basePrefix, isSourceFatalError } from "src/activities/utils/utils";
import { FatalError, RetryableError, RetryExceededError } from "src/errors/errors.types";
import { RedisService } from "src/redis/redis.service";
import { CommonTaskService } from "../common/common-task.service";
import { DiscoveryScanService } from "./discovery/discovery-scan.service";
import { MigrateScanService } from "./migrate/migrate-scan.service";
import { BatchSubDirInput, BatchSubDirOutput, ScanActivityInput, ScanActivityOutput, ScanDirectoryInput, ScanDirectoryOutput, ScanDirectorySettings, TaskExecInput, TaskExecOutput, UpdateAndReportTaskInput } from './scan-activity.type';
import { calculateHash } from "src/activities/utils/checksum-utils";





@Injectable()
export class ScanService {
    readonly workerId: string;
    readonly maxMigrationCommand : number;
    readonly maxConcurrency: number;
    readonly maxRetryCount: number;

    constructor(
        @Inject(ConfigService) 
        private readonly configService: ConfigService,
        private readonly redisService: RedisService,
        private readonly commonTaskService: CommonTaskService,
        private readonly migrateScanService: MigrateScanService,
        private readonly  discoveryScanService: DiscoveryScanService,
    ) {
        this.workerId = this.configService.get<string>('worker.workerId');
        this.maxMigrationCommand = this.configService.get('worker.maxMigrationCommand') || 100;
        this.maxConcurrency = this.configService.get('worker.maxCommandConcurrency') || 100; 
        this.maxRetryCount = this.configService.get('worker.maxRetryCount') || 3;  
    }


    async scanDirectories ({jobRunId, isMigration, batchSize, batchId}: ScanActivityInput): Promise<ScanActivityOutput>  {
        const scanActivityContext = Context.current();
        const heartbeatInterval = setInterval(() => {
            scanActivityContext.heartbeat({});
        }, 2000);
        let scanActivityOutput: ScanActivityOutput = {
            dirCount: 0,
            fileCount: 0,
            subDirs: [],
            jobRunId: jobRunId,
            batchDirs: []
        };
        try{                           
            const jobContext: JobManagerContext = await this.redisService.getJobManagerContext(jobRunId);            
            let task = await this.commonTaskService.buildOrGetValidScanTask({
                taskHashId: scanActivityContext.info.activityId,
                jobContext,
                jobRunId,
                batchId
            });
            if (task && task?.commands.length > 0) {
                task.status = TaskStatus.RUNNING;
                task.workerId = this.workerId;
                await jobContext.publishToTaskStream(task);

                let result: TaskExecOutput = await this.executeTask({
                    activityId: scanActivityContext.info.activityId,
                    jobContext,
                    jobRunId,
                    task,
                    isMigration,
                    batchSize
                });

                const updateAndReportTaskInput: UpdateAndReportTaskInput = {
                    errors: result.errors,
                    jobContext,
                    taskHashId: scanActivityContext.info.activityId,
                    task,
                    retryCount: result.retryCount
                }                        
                await this.updateAndReportTaskStatus(updateAndReportTaskInput)  
                scanActivityOutput = result.result;
            }
            if (batchId) await jobContext.deleteBatchDir(batchId);
            return scanActivityOutput;

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

    async executeTask({activityId, jobContext, jobRunId, task, isMigration, batchSize}: TaskExecInput): Promise<TaskExecOutput>{
        const baseSourcePrefixPath = basePrefix(jobRunId, task.sPathId);
        const baseTargetPrefixPath = basePrefix(jobRunId, task.tPathId);
        const output: ScanActivityOutput = { dirCount: 0, fileCount: 0, subDirs: [], jobRunId: jobRunId, batchDirs: [] };    
        let errors: string[] = [], errorType: ErrorType = task.retryCount + 1 >= this.maxRetryCount ? ErrorType.TRANSIENT_ERROR : ErrorType.RECOVERABLE_ERROR;
        task.retryCount++;
        const settings = this.getScanSettings(jobContext);
        for (let i = 0; i < task.commands.length; i += this.maxConcurrency) {
            const batch = task.commands.slice(i, i + this.maxConcurrency);
            await Promise.allSettled(
                batch.map(async (command) => {
                    const scanDirectoryInput : ScanDirectoryInput = {
                        settings,
                        sourcePath: `${baseSourcePrefixPath}${command.fPath}`,
                        sourcePrefix: baseSourcePrefixPath,
                        targetPrefix: baseTargetPrefixPath,
                        targetPath: `${baseTargetPrefixPath}${command.fPath}`,
                        jobContext,
                        command,
                        errorType
                    }
                    try {
                        let result: ScanDirectoryOutput;
                        if (isMigration) {
                            result = await this.migrateScanService.scanDirectory(scanDirectoryInput);
                        }
                        else {
                            result = await this.discoveryScanService.scanDirectory(scanDirectoryInput);
                        }
                        output.fileCount += result.fileCount;
                        output.dirCount += result.dirCount;
                        output.subDirs.push(...result.subDirs);
                    }catch(error) {
                        errors.push(error.code ?? '')
                    }
                    await jobContext.setTask(activityId, task);
                })
            )
        }
        const { batchDirs, subDirs }: BatchSubDirOutput = await this.batchSubDirs({subDirs: output.subDirs, batchSize, jobContext});
        output.subDirs = subDirs;
        output.batchDirs = batchDirs;
        return {result:output, errors, retryCount: task.retryCount};
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

    async batchSubDirs({batchSize, subDirs, jobContext}: BatchSubDirInput): Promise<BatchSubDirOutput> {
        const batchDirsId: string[] = []
        while(subDirs.length > batchSize) {
            const batchDirs: string[] = subDirs.splice(0, batchSize);
            const batchId: string = calculateHash(batchDirs)
            batchDirsId.push(batchId);
            await jobContext.setBatchDir(batchId, batchDirs);
        }
        if(subDirs.length > 0) {
            const batchId: string = calculateHash(subDirs);
            batchDirsId.push(batchId);
            await jobContext.setBatchDir(batchId, subDirs);
        }
        return { subDirs: [], batchDirs: batchDirsId };
    }
}
