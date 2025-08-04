import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandStatus, ErrorType, FileInfo, JobContext, TaskStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import * as fs from 'fs';
import * as path from 'path';
import { RedisService } from 'src/redis/redis.service';
import { CommonActivityService } from '../common/common.service';
import { basePrefix, dmError, getFileInfo, getServerInfoFromPath, createServerDownErrorMessage, isFatalError, removePrefix, shouldExcludeOrSkip } from '../utils/utils';
import { Operation, Origin } from '../utils/utils.types';
import { DiscoverPathInput, DiscoverPathOutput, DiscoveryInput, DiscoveryOutput, ScanDirCommandInput, ScanDirCommandOutput } from './discovery.type';
import { Context } from '@temporalio/activity';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { isPathExists } from '../core/utils/utils';

@Injectable()
export class DiscoveryScanActivity {
    readonly workerId: string;
    readonly maxRetryCount: number;
    readonly maxConcurrency: number;
    readonly operationTimeout: number;
    private readonly logger: LoggerService;

    constructor(
        @Inject(LoggerFactory) loggerFactory: LoggerFactory,
        private readonly redisService: RedisService,
        @Inject(ConfigService) private readonly configService: ConfigService,
        private readonly commonService: CommonActivityService
    ) {
        this.maxRetryCount = this.configService.get('worker.maxRetryCount');
        this.workerId = this.configService.get<string>('worker.workerId');
        this.maxConcurrency = this.configService.get('worker.maxCommandConcurrency') || 250; 
        this.operationTimeout = this.configService.get('worker.operationTimeout') || 5000;
        this.logger = loggerFactory.create(DiscoveryScanActivity.name);
    }

    async getDirectoryContents(directoryPath: string, jobContext: JobContext): Promise<fs.Dirent[]> {
        this.logger.debug(`[${jobContext.jobRunId}] Checking directory access: ${directoryPath}`);

        await fs.promises.access(directoryPath, fs.constants.R_OK);

        const result = await Promise.race<fs.Dirent[]>([
            fs.promises.readdir(directoryPath, { withFileTypes: true }),

            new Promise<never>((_, reject) => {
                const serverInfo = getServerInfoFromPath(directoryPath, jobContext);
                const errorMessage = createServerDownErrorMessage('ETIMEDOUT', serverInfo);
                const err = new Error(errorMessage);
                (err as any).code = 'ETIMEDOUT';
                setTimeout(() => reject(err), this.operationTimeout);
            })
        ]);

        this.logger.debug(`[${jobContext.jobRunId}] Successfully read directory: ${directoryPath}`);
        return result;
    }

    async scanTaskActivity({ jobRunId, failedWorkers }: DiscoverPathInput): Promise<DiscoverPathOutput> {
        const scanActivityOutput: DiscoverPathOutput = { 
            isFatalErrored: false, 
            noTaskFound: false, 
            taskId: undefined, 
            files: 0, 
            folders: 0, 
            workerId: this.workerId 
        };
        
        this.logger.log(`[${jobRunId}] Starting Discovery Scan Activity`);
        const jobContext: JobContext = await this.redisService.getJobContext(jobRunId);

        if(failedWorkers.includes(this.workerId)) {
            scanActivityOutput.isFatalErrored = true;
            scanActivityOutput.noTaskFound = true;
            this.logger.debug(`[${jobRunId}] Worker already failed => ${this.workerId}`);
            return scanActivityOutput;
        }
        
        let task = await jobContext.getScanTask(this.workerId);
        if(task) this.logger.debug(`[${jobRunId}] Task already fetched: ${JSON.stringify(task)}`);
        if(!task) task = await this.commonService.fetchOneTask(jobContext);

        this.logger.debug(`[${jobRunId}] Task fetched: ${JSON.stringify(task)}`);
        if (!task) {
            scanActivityOutput.noTaskFound = true;
            return scanActivityOutput;
        }
        await jobContext.setScanTask(this.workerId, task);

        scanActivityOutput.taskId = task.id;

        task.workerId = this.workerId;
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

        this.logger.debug(`[${jobRunId}] Discovery Scan Activity completed with ${discoverOutput.errors.size} errors and ${discoverOutput.success} success.`);
        if (discoverOutput.errors.size === 0)
            this.logger.log(`[${task.jobRunId}] Discovery Scan Activity Completed.`);
        else
            this.logger.error(`[${task.jobRunId}] Discovery Scan Activity ERRORED.`);
        await this.redisService.setJobContext(task.jobRunId, jobContext);

        this.logger.debug(`[${jobRunId}] Discovery Scan Activity Completed ${JSON.stringify(scanActivityOutput)}`);

        await jobContext.deleteScanTask(this.workerId);
        return scanActivityOutput;
    }


    async discover({ task, jobContext }: DiscoveryInput): Promise<DiscoveryOutput> {
        const scanPath: DiscoveryOutput = {
            errors: new Set<string>(),
            success: 0,
            error: 0,
            retryCount: 0,
            isFatal: false,
            files: 0,
            folders: 0
        };

        const basePrefixPath = basePrefix(jobContext.jobRunId, jobContext.jobConfig.sourceFileServer.pathId);
        const excludePatterns = jobContext?.jobConfig?.options?.excludeFilePattern ?
            jobContext.jobConfig.options.excludeFilePattern.split(",") : [];
        const skipFile = jobContext?.jobConfig?.options?.skipsFilesModifiedInLast ?
            jobContext.jobConfig.options.skipsFilesModifiedInLast : '';

        for (let i = 0; i < task.commands.length; i += this.maxConcurrency) {
            const batch = task.commands.slice(i, i + this.maxConcurrency);

            await Promise.allSettled(
                batch.map(async (command) => {
                    if (command.status === CommandStatus.COMPLETED) return;

                    this.logger.debug(`[${jobContext.jobRunId}] Processing scan for path: ${command?.fPath}`);

                    const scanInput: ScanDirCommandInput = {
                        excludePatterns: excludePatterns,
                        sourcePath: `${basePrefixPath}${command.fPath}`,
                        sourcePrefix: basePrefixPath,
                        command,
                        jobContext,
                        skipFile,
                        errorType: command.retryCount+1 >= this.maxRetryCount ? ErrorType.TRANSIENT_ERROR : ErrorType.RECOVERABLE_ERROR
                    };

                    const scanOutput = await this.scanDirCommand(scanInput);
                    
                    this.logger.debug(`[${jobContext.jobRunId}] Scan output for path ${command?.fPath}: ${JSON.stringify(scanOutput)}`);

                    scanPath.files += scanOutput.files;
                    scanPath.folders += scanOutput.directory;

                    if (scanOutput.error) {
                        command.retryCount++;
                        command.status = CommandStatus.ERROR;
                        scanPath.errors.add(scanOutput.error);
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

    async scanDirCommand({ excludePatterns = [], jobContext, sourcePath, sourcePrefix, command, skipFile, errorType }: ScanDirCommandInput): Promise<ScanDirCommandOutput> {
        const scanDirOutput: ScanDirCommandOutput = {
            files: 0, 
            directory: 0, 
            isFatal: false, 
            error: undefined, 
            errorType: errorType,
        };

        try {
            this.logger.debug(`[${jobContext.jobRunId}] Scanning directory: ${sourcePath}`);
            const sourceContent = await this.getDirectoryContents(sourcePath, jobContext);

            for (const item of sourceContent) {
                const sourceContentPath = path.join(sourcePath, item.name);

                let sourceStat: fs.Stats;
                try {
                    sourceStat = await fs.promises.lstat(sourceContentPath);
                } catch (err) {
                    this.logger.debug(`[${jobContext.jobRunId}] Skipping path: "${sourceContentPath}" (lstat failed: ${err.message})`);
                    continue;
                }

                let resolvedTarget = '';

                if (sourceStat.isSymbolicLink()) {
                    try {
                        const linkTarget = await fs.promises.readlink(sourceContentPath);
                        resolvedTarget = path.resolve(path.dirname(sourceContentPath), linkTarget);
                        const targetExists = await isPathExists(resolvedTarget);
                        if (!targetExists) {
                            this.logger.debug(`[${jobContext.jobRunId}] Broken symbolic link: "${sourceContentPath}" → "${resolvedTarget}" (target does not exist)`);
                        }
                    } catch (err) {
                        this.logger.debug(`[${jobContext.jobRunId}] Error reading symbolic link: "${sourceContentPath}" (${err.message})`);
                    }
                }               

                if (shouldExcludeOrSkip({
                    fullPath: sourceContentPath,
                    stats: sourceStat,
                    excludePatterns,
                    skipTime: skipFile,
                    olderThan: new Date(jobContext.jobConfig.options?.excludeOlderThan),
                    jobType: jobContext.jobConfig.jobType
                })) continue;

                const relativeSourcePath = removePrefix(sourceContentPath, sourcePrefix);
                const fileInfo: FileInfo = await getFileInfo({ 
                    name: item.name, 
                    fullFilePath: sourceContentPath, 
                    relativePath: relativeSourcePath 
                });

                if (sourceStat.isDirectory()) {
                    if(sourceStat.isSymbolicLink()) continue;
                    this.logger.debug(`[${jobContext.jobRunId}] Adding directory to stream: ${fileInfo.path}`);
                    jobContext.dirsInfo.lastId = await jobContext.appendToDirList(fileInfo);
                    jobContext.dirsInfo.numMessages++;
                    scanDirOutput.directory++;
                }
                else scanDirOutput.files++;
                this.logger.debug(`[${jobContext.jobRunId}] Adding file to stream: ${fileInfo.path}`);
                jobContext.dirsInfo.lastId = await jobContext.appendToFileList(fileInfo);
                jobContext.dirsInfo.numMessages++;
            }

        } catch (error: any) {
            this.logger.error(`[${jobContext.jobRunId}] Error scanning directory ${sourcePath}`);
            
            const dmErr = dmError("OPERATION", Origin.SOURCE, Operation.READ_DIR, scanDirOutput.errorType, command.commandId, error, {
                name: command.fPath,
                path: sourcePath,
            });

            jobContext.errorsInfo.lastId = await jobContext.appendToErrorList(dmErr);
            scanDirOutput.error = error?.code || '';
        }

        return scanDirOutput;
    }

    async scanActivity({ jobRunId, failedWorkers }) {
        const ctx = Context.current();
        const interval = setInterval(() => { 
            ctx.heartbeat({ workerId: this.workerId }) 
        }, 10000);

        try {
            return await this.scanTaskActivity({ jobRunId, failedWorkers });
        } finally {
            clearInterval(interval);
        }
    }
}