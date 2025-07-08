import { JobManger } from "@local/job-lib";
import { JobConfig } from "@local/job-lib/dist/job-manager/data-store/jobconfig/job-config";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TaskStatus } from "@netapp-cloud-datamigrate/jobs-lib";
import { Context } from '@temporalio/activity';
import { basePrefix, isSourceFatalError } from "src/activities/utils/utils";
import { FatalError, RetryableError, RetryExceededError } from "src/errors/errors.types";
import { CommonTaskService } from "../common/common-task.service";
import { DiscoveryScanService } from "./discovery/discovery-scan.service";
import { MigrateScanService } from "./migrate/migrate-scan.service";
import { ScanActivityInput, ScanActivityOutput, ScanDirectoryInput, ScanDirectoryOutput, ScanDirectorySettings, TaskExecInput, TaskExecOutput, UpdateAndReportTaskInput } from './scan-activity.type';




@Injectable()
export class ScanService {
    readonly workerId: string;
    readonly maxMigrationCommand : number;
    readonly maxConcurrency: number;
    readonly maxRetryCount: number;

    constructor(
        @Inject(ConfigService) 
        private readonly configService: ConfigService,
        private readonly jobManager: JobManger,
        private readonly commonTaskService: CommonTaskService,
        private readonly migrateScanService: MigrateScanService,
        private readonly  discoveryScanService: DiscoveryScanService,
        private readonly logger: Logger
    ) {
        this.workerId = this.configService.get<string>('worker.workerId');
        this.maxMigrationCommand = this.configService.get('worker.maxMigrationCommand') || 100;
        this.maxConcurrency = this.configService.get('worker.maxCommandConcurrency') || 100; 
        this.maxRetryCount = this.configService.get('worker.maxRetryCount') || 3;  
    }


    async scanDirectories ({jobRunId, dirsToScan, isMigration}: ScanActivityInput): Promise<ScanActivityOutput>  {
        const scanActivityContext = Context.current();
        const heartbeatInterval = setInterval(() => {
            scanActivityContext.heartbeat({});
        }, 2000);
        
        try{                           
            
            let task = await this.commonTaskService.buildOrGetValidScanTask({
                dirToScans: dirsToScan,
                taskHashId: scanActivityContext.info.activityId,
                jobRunId
            });

            task.status = TaskStatus.RUNNING;
            task.workerId = this.workerId;
            await this.jobManager.publishToTaskStream(jobRunId, task);

            const jobConfig = await this.jobManager.getJobConfig(jobRunId);

            let result: TaskExecOutput = await this.executeTask({
                activityId: scanActivityContext.info.activityId,
                jobRunId,
                task,
                isMigration,
                jobConfig
            });

            const updateAndReportTaskInput: UpdateAndReportTaskInput = {
                errors: result.errors,
                jobRunId,
                taskHashId: scanActivityContext.info.activityId,
                task,
                retryCount: result.retryCount
            }                        
            await this.updateAndReportTaskStatus(updateAndReportTaskInput)    
            return result.result;

        }catch(error){
            this.logger.error(`Error in scanDirectories: ${error.message}`, error.stack);
            if(error instanceof FatalError || error instanceof RetryExceededError) 
                throw error;  
            //TODO: this is not requried we can just throw the error.isn't it ?     
            throw new RetryableError(error.message)
        }        
        finally{
            clearInterval(heartbeatInterval);
        }        
    }

    getScanSettings(jobConfig: JobConfig ): ScanDirectorySettings {
        const settings: ScanDirectorySettings = {
            skipFile: jobConfig.options?.skipsFilesModifiedInLast ?? '',
            excludePatterns: jobConfig.options?.excludeFilePattern ? jobConfig.options.excludeFilePattern.split(",") : []
        }
        return settings;
    }

    async executeTask({activityId, jobConfig, jobRunId, task, isMigration}: TaskExecInput): Promise<TaskExecOutput>{
        const baseSourcePrefixPath = basePrefix(jobRunId, task.sPathId);
        const baseTargetPrefixPath = basePrefix(jobRunId, task.tPathId);
        const output: ScanActivityOutput = { dirCount: 0, fileCount: 0, subDirs: [], jobRunId: jobRunId }    
        let errors: string[] = [], retryCount: number = 0;        
        const settings = this.getScanSettings(jobConfig);
        for (let i = 0; i < task.commands.length; i += this.maxConcurrency) {
            const batch = task.commands.slice(i, i + this.maxConcurrency);
            await Promise.allSettled(
                batch.map(async (command) => {
                    const scanDirectoryInput : ScanDirectoryInput = {
                        settings,
                        sourcePath: `${baseSourcePrefixPath}${command.fPath}`,
                        sourcePrefix: baseSourcePrefixPath,
                        targetPath: `${baseTargetPrefixPath}${command.fPath}`,
                        jobConfig,
                        command,
                        jobRunId
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
                    command.retryCount++;
                    retryCount = Math.max(command.retryCount, retryCount);
                    this.jobManager.setTask(jobRunId, activityId, task)
                })
            )
        }
        return {result:output, errors, retryCount}
    }

    async updateAndReportTaskStatus({ errors, jobRunId, taskHashId, task, retryCount }: UpdateAndReportTaskInput) {
        if(errors.length == 0) {
            task.status = TaskStatus.COMPLETED
            await this.jobManager.publishToTaskStream(jobRunId, task);
            await this.jobManager.deleteTask(jobRunId,taskHashId);   
            return;
        }
        
        task.status = TaskStatus.ERRORED
        await this.jobManager.publishToTaskStream(jobRunId, task);
       
        if (errors.some(isSourceFatalError)) {
            await this.jobManager.deleteTask(jobRunId, taskHashId);
            throw new FatalError(`Sync Task Update Failed: ${errors.length} source errors with retry count ${retryCount} With Fatal Error`);
        }

        if (retryCount >= this.maxRetryCount) {
            await this.jobManager.deleteTask(jobRunId, taskHashId);
            throw new RetryExceededError(`Task ${task.id} has exceeded maximum retry count of ${this.maxRetryCount}`);
        }
        throw new RetryableError(`Sync Task Update Failed: ${errors.length} source errors with retry count ${retryCount} With Retryable Error`);
        
    }
}
