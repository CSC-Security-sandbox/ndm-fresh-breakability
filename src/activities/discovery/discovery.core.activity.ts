import { Inject, Injectable, Logger } from '@nestjs/common';
import { CommandStatus, ErrorType, FileInfo, JobContext, TaskStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { JobState } from '@netapp-cloud-datamigrate/jobs-lib/dist/types/job-state';
import { RedisService } from 'src/redis/redis.service';
import { basePrefix, dmError, getFileInfo, isFatalError, removePrefix, shouldExcludeOrSkip } from '../utils/utils';
import { Operation, Origin } from '../utils/utils.types';
import { DiscoverPathInput, DiscoverPathOutput, DiscoveryInput, DiscoveryOutput, ScanDirCommandInput, ScanDirCommandOutput } from './discovery.type';
import { CommonActivityService } from '../common/common.service';

@Injectable()
export class DiscoveryScanActivity {

    readonly workerId: string;
    readonly maxRetryCount: number = 3;
    readonly bathSize: number = 1000;
    readonly maxConcurrency :number 
    constructor(
        private readonly logger: Logger,
        private readonly redisService: RedisService,
        @Inject(ConfigService) private readonly configService: ConfigService,
        private readonly commonService: CommonActivityService
    ) {
        this.maxRetryCount = this.configService.get('worker.maxRetryCount');
        this.workerId = this.configService.get<string>('worker.workerId');
        this.maxConcurrency = this.configService.get('worker.maxConcurrency') || 250; 
    }

    async getDirectoryContents(directoryPath: string): Promise<string[]> {
        if (!fs.existsSync(directoryPath))
            return [];
        return await fs.promises.readdir(directoryPath);
    }

    async scanActivity({ jobRunId }: DiscoverPathInput): Promise<DiscoverPathOutput> {

        const scanActivityOutput: DiscoverPathOutput = { isFatalErrored: false, noTaskFound: false, taskId: undefined, files: 0, folders: 0 };
        this.logger.log(`[${jobRunId}] Starting Discovery Scan Activity`);
        const jobContext: JobContext = await this.redisService.getJobContext(jobRunId);

        const task = await this.commonService.fetchOneTask(jobContext)
        this.logger.debug(`[${jobRunId}] Task fetched: ${JSON.stringify(task)}`);
        if (!task) {
            scanActivityOutput.noTaskFound = true;
            return scanActivityOutput;
        }

        scanActivityOutput.taskId = task.id;

        const jobState: JobState = await jobContext.getJobState();

        task.status = TaskStatus.RUNNING;
        for (let i = 0; i < task.commands.length; i++)
            if (task.commands[i].status !== CommandStatus.COMPLETED)
                task.commands[i].status = CommandStatus.IN_PROCESS

        jobContext.updatedTaskInfo.lastId = await jobContext.appendToUpdatedTaskList(task);
        await this.redisService.setJobContext(task.jobRunId, jobContext);

        const discoverOutput = await this.discover({ task, jobContext });


        scanActivityOutput.isFatalErrored = discoverOutput.isFatal;
        scanActivityOutput.files = discoverOutput.files;
        scanActivityOutput.folders = discoverOutput.folders;

        const newJobState = { ...jobState, tasks_completed: jobState.tasks_completed + 1 };
        jobContext.jobState = new JobState(newJobState.workers, newJobState.tasks_completed, newJobState.tasks_total, newJobState.workers_agreed ?? [], newJobState.status, newJobState.failedWorkers ?? []);

        if (discoverOutput.errors.size === 0)
            this.logger.log(`[${task.jobRunId}] Discovery Scan Activity Completed.`);
        else
            this.logger.error(`[${task.jobRunId}] Discovery Scan Activity ERRORED.`);
        await this.redisService.setJobContext(task.jobRunId, jobContext);

        this.logger.debug(`[${jobRunId}] Discovery Scan Activity Completed ${JSON.stringify(scanActivityOutput)}`);
        return scanActivityOutput
    }


    async discover({ task, jobContext }: DiscoveryInput): Promise<DiscoveryOutput> {
        const scanPath: DiscoveryOutput = { errors: new Set<string>(), success: 0, error: 0, retryCount: 0, isFatal: false, files: 0, folders: 0 };
        const basePrefixPath = basePrefix(jobContext.jobRunId, jobContext.jobConfig.sourceFileServer.pathId)
        const excludePatterns = jobContext.jobConfig.options?.excludeFilePattern ? jobContext.jobConfig.options.excludeFilePattern.split(",") : [];
        const skipFile = jobContext.jobConfig.options?.skipsFilesModifiedInLast ? jobContext.jobConfig.options.skipsFilesModifiedInLast : '';


        for (let i = 0; i < task.commands.length; i += this.maxConcurrency) {
            const batch = task.commands.slice(i, i + this.maxConcurrency);

            await Promise.allSettled(
                batch.map(async (command) => {
                    if (command.status === CommandStatus.COMPLETED) return;

                    this.logger.debug(`[${jobContext.jobRunId}] Processing command: ${JSON.stringify(command)}`);

                    const scanInput: ScanDirCommandInput = {
                        excludePatterns: excludePatterns,
                        sourcePath: `${basePrefixPath}${command.fPath}`,
                        sourcePrefix: basePrefixPath,
                        command,
                        jobContext,
                        skipFile
                    };

                    const scanOutput = await this.scanDirCommand(scanInput);
                    scanPath.files += scanOutput.files;
                    scanPath.folders += scanOutput.directory;
                    this.logger.debug(`Result of scanContent: ${JSON.stringify(scanOutput)}`);

                    if (scanOutput.error) {
                        command.retryCount++;
                        command.status = CommandStatus.ERROR;
                        scanPath.errors.add(scanOutput.error);
                        scanPath.error++;
                    } else {
                        scanPath.success++;
                        command.status = CommandStatus.COMPLETED;
                    }
                    scanPath.retryCount = Math.max(command.retryCount, scanPath.retryCount);
                })
            );
        }

        if (scanPath.error > 0 && scanPath.retryCount >= this.maxRetryCount)
            task.status = TaskStatus.ERRORED
        else if (scanPath.retryCount > 0)
            task.status = TaskStatus.COMPLETED_WITH_ERROR
        else
            task.status = TaskStatus.COMPLETED

        if (scanPath.error > 0) {
            for (const error of scanPath.errors)
                if (isFatalError(error)) {
                    scanPath.isFatal = true;
                    break;
                }
            const errorType = scanPath.isFatal ? ErrorType.FATAL_ERROR : scanPath.retryCount >= this.maxRetryCount ? ErrorType.TRANSIENT_ERROR : ErrorType.RECOVERABLE_ERROR;
            const dmErr = dmError("TASK", Origin.SOURCE, Operation.READ_DIR, errorType, task.id, undefined, undefined, {
                errorCode: scanPath.errors.size > 0 ? Array.from(scanPath.errors) : [],
                message: `Task ${task.id} has ${scanPath.error} errors and ${scanPath.success} success during scan`
            });
            if (errorType === ErrorType.TRANSIENT_ERROR || errorType === ErrorType.FATAL_ERROR)
                task.status = TaskStatus.ERRORED;
            await jobContext.appendToErrorList(dmErr);
            if (scanPath.retryCount < this.maxRetryCount && !scanPath.isFatal) {
                this.logger.debug(`Appending to Retry => ${JSON.stringify(task)}`)
                jobContext.tasksInfo.lastId = await jobContext.appendToTaskList(task);
            }
            else if (scanPath.isFatal) {
                this.logger.debug(`Fatal Error Detected for task ${task.id}`)
                jobContext.updatedTaskInfo.lastId = await jobContext.appendToUpdatedTaskList(task);
            }
        }
        else {
            jobContext.updatedTaskInfo.lastId = await jobContext.appendToUpdatedTaskList(task);
        }

        await this.redisService.setJobContext(task.jobRunId, jobContext);
        return scanPath;
    }

    async scanDirCommand({ excludePatterns = [], jobContext, sourcePath, sourcePrefix, command, skipFile }: ScanDirCommandInput): Promise<ScanDirCommandOutput> {
        const scanDirOutput: ScanDirCommandOutput = {
            files: 0, directory: 0, isFatal: false, error: undefined, errorType: command.retryCount >= this.maxRetryCount ? ErrorType.TRANSIENT_ERROR : ErrorType.RECOVERABLE_ERROR,
        }
        try {
            const sourceContent = await this.getDirectoryContents(sourcePath);

            for (const item of sourceContent) {
                const sourceContentPath = path.join(sourcePath, item);
                if (!fs.existsSync(sourceContentPath)) continue;

                const sourceStat = await fs.promises.lstat(sourceContentPath);

                if (shouldExcludeOrSkip({
                    fullPath: sourceContentPath,
                    stats: sourceStat,
                    excludePatterns,
                    skipTime: skipFile,
                    olderThan: new Date(jobContext.jobConfig.options?.excludeOlderThan),
                    jobType: jobContext.jobConfig.jobType
                })) continue;

                const relativeSourcePath = removePrefix(sourceContentPath, sourcePrefix);
                const fileInfo: FileInfo = await getFileInfo({ name: item, fullFilePath: sourceContentPath, relativePath: relativeSourcePath });

                if (sourceStat.isDirectory()) {
                    if(sourceStat.isSymbolicLink()) continue;
                    jobContext.dirsInfo.lastId = await jobContext.appendToDirList(fileInfo);
                    jobContext.dirsInfo.numMessages++;
                    scanDirOutput.directory++;
                    this.logger.log(`[${jobContext.jobRunId}] *************** Appending to dir list ***************`);
                }
                else scanDirOutput.files++;

                jobContext.dirsInfo.lastId = await jobContext.appendToFileList(fileInfo);
                jobContext.dirsInfo.numMessages++;
                this.logger.log(`[${jobContext.jobRunId}] *************** Appending to file list ***************`);
            }

        } catch (error) {
            const dmErr = dmError("OPERATION", Origin.SOURCE, Operation.READ_DIR, scanDirOutput.errorType, command.commandId, error, { name: command.fPath, path: sourcePath });
            jobContext.errorsInfo.lastId = await jobContext.appendToErrorList(dmErr);
            scanDirOutput.error = error?.code || '';
        }
        return scanDirOutput
    }
}