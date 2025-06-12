import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandStatus, ErrorType, FileInfo, JobContext, TaskStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import * as fs from 'fs';
import * as path from 'path';
import { RedisService } from 'src/redis/redis.service';
import { CommonActivityService } from '../common/common.service';
import { basePrefix, dmError, getFileInfo, isServerDownError, getServerInfoFromPath, createServerDownErrorMessage, removePrefix, shouldExcludeOrSkip } from '../utils/utils';
import { Operation, Origin } from '../utils/utils.types';
import { DiscoverPathInput, DiscoverPathOutput, DiscoveryInput, DiscoveryOutput, ScanDirCommandInput, ScanDirCommandOutput } from './discovery.type';
import { Context } from '@temporalio/activity';

@Injectable()
export class DiscoveryScanActivity {

    readonly workerId: string;
    readonly maxRetryCount: number;
    readonly maxConcurrency: number;
    readonly retries: number;
    readonly timeout: number;
    readonly delay: number;
    constructor(
        private readonly logger: Logger,
        private readonly redisService: RedisService,
        @Inject(ConfigService) private readonly configService: ConfigService,
        private readonly commonService: CommonActivityService
    ) {
        this.maxRetryCount = this.configService.get('worker.maxRetryCount');
        this.workerId = this.configService.get<string>('worker.workerId');
        this.maxConcurrency = this.configService.get('worker.maxCommandConcurrency') || 250; 
        this.timeout = this.configService.get('worker.timeout');
    }

    async getDirectoryContents(directoryPath: string, jobContext: JobContext): Promise<fs.Dirent[]> {
        try {
            this.logger.debug(`[${jobContext.jobRunId}] Checking directory access: ${directoryPath}`);

            await fs.promises.access(directoryPath, fs.constants.R_OK);
            
            const result = await Promise.race<fs.Dirent[]>([
                fs.promises.readdir(directoryPath, { withFileTypes: true }),

                new Promise<never>((_, reject) => {
                    const err = new Error('Timeout reading directory');
                    (err as any).code = 'ETIMEDOUT';
                    setTimeout(() => reject(err), this.timeout);
                })
            ]);

            this.logger.debug(`[${jobContext.jobRunId}] Successfully read directory: ${directoryPath}`);
            return result;
        } catch (error) {
            const serverInfo = getServerInfoFromPath(directoryPath, jobContext);

            if (isServerDownError(error)) {
                const errorMessage = createServerDownErrorMessage(error, serverInfo);
                this.logger.error(`[${jobContext.jobRunId}] ${errorMessage}`);

                const enhancedError = new Error(errorMessage);
                enhancedError.name = 'ServerDownError';
                (enhancedError as any).code = error?.code || 'SERVER_UNREACHABLE';
                (enhancedError as any).originalError = error?.message;
                (enhancedError as any).serverInfo = serverInfo;

                throw enhancedError;
            }

            this.logger.error(`[${jobContext.jobRunId}] Directory access failed: ${directoryPath}, Error: ${error.message}`);
            throw error;
        }
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
        for (let i = 0; i < task.commands.length; i++) {
            if (task.commands[i].status !== CommandStatus.COMPLETED) {
                task.commands[i].status = CommandStatus.IN_PROCESS;
            }
        }

        jobContext.updatedTaskInfo.lastId = await jobContext.appendToUpdatedTaskList(task);
        await this.redisService.setJobContext(task.jobRunId, jobContext);

        try {
            const discoverOutput = await this.discover({ task, jobContext });

            scanActivityOutput.isFatalErrored = discoverOutput.isFatal;
            scanActivityOutput.files = discoverOutput.files;
            scanActivityOutput.folders = discoverOutput.folders;

            this.logger.debug(`[${jobRunId}] Discovery Scan Activity completed with ${discoverOutput.errors.size} errors and ${discoverOutput.success} success.`);
            
            if (discoverOutput.errors.size === 0) {
                this.logger.log(`[${task.jobRunId}] Discovery Scan Activity Completed.`);
            } else {
                this.logger.error(`[${task.jobRunId}] Discovery Scan Activity ERRORED.`);
            }
            
        } catch (fatalError) {
            this.logger.error(`[${jobRunId}] Fatal error in discovery process: ${JSON.stringify(fatalError)}`);
            this.logger.error(`[${jobRunId}] Fatal error in discovery process: ${JSON.stringify(fatalError, Object.getOwnPropertyNames(fatalError))}`);
            scanActivityOutput.isFatalErrored = true;
        }

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
        const excludePatterns = jobContext.jobConfig.options?.excludeFilePattern ? 
            jobContext.jobConfig.options.excludeFilePattern.split(",") : [];
        const skipFile = jobContext.jobConfig.options?.skipsFilesModifiedInLast ? 
            jobContext.jobConfig.options.skipsFilesModifiedInLast : '';

        for (let i = 0; i < task.commands.length; i += this.maxConcurrency) {
            const batch = task.commands.slice(i, i + this.maxConcurrency);

            const results = await Promise.allSettled(
                batch.map(async (command) => {
                    if (command.status === CommandStatus.COMPLETED) return;

                    this.logger.debug(`[${jobContext.jobRunId}] Processing command: ${JSON.stringify(command)}`);

                    const scanInput: ScanDirCommandInput = {
                        excludePatterns: excludePatterns,
                        sourcePath: `${basePrefixPath}${command.fPath}`,
                        sourcePrefix: basePrefixPath,
                        command,
                        jobContext,
                        skipFile,
                        errorType: ErrorType.FATAL_ERROR
                    };

                    try {
                        const scanOutput = await this.scanDirCommand(scanInput);
                        
                        scanPath.files += scanOutput.files;
                        scanPath.folders += scanOutput.directory;
                        
                        if (scanOutput.error) {
                            command.retryCount++;
                            command.status = CommandStatus.ERROR;
                            scanPath.errors.add(scanOutput.error);
                            scanPath.error++;
    
                            if (scanOutput.isFatal) {
                                this.logger.error(`[${jobContext.jobRunId}] Fatal server connectivity error detected`);
                                scanPath.isFatal = true;
                                task.status = TaskStatus.ERRORED;
                                return;
                            }
                        } else {
                            scanPath.success++;
                            command.status = CommandStatus.COMPLETED;
                            await jobContext.setScanTask(this.workerId, task);
                        }
                        
                        scanPath.retryCount = Math.max(command.retryCount, scanPath.retryCount);
                        
                    } catch (fatalError) {
                        this.logger.error(`[${jobContext.jobRunId}] Fatal error during scanDirCommand1: ${JSON.stringify(fatalError)}`);
                        this.logger.error(`[${jobContext.jobRunId}] Fatal error during scanDirCommand: ${JSON.stringify(fatalError, Object.getOwnPropertyNames(fatalError))}`);
                        scanPath.isFatal = true;
                        task.status = TaskStatus.ERRORED;
                        
                        if (isServerDownError(fatalError)) {
                            const serverInfo = getServerInfoFromPath(scanInput.sourcePath, jobContext);
                            scanPath.errors.add(createServerDownErrorMessage(fatalError, serverInfo));
                        } else {
                            scanPath.errors.add(fatalError?.message || 'Unknown fatal error');
                        }
                        
                        throw fatalError;
                    }
                })
            );

            const rejectedResults = results.filter(result => result.status === 'rejected');
            if (rejectedResults.length > 0) {
                this.logger.error(`[${jobContext.jobRunId}] ${rejectedResults.length} fatal errors occurred in batch processing`);
                scanPath.isFatal = true;
                break;
            }
        }

        if (scanPath.isFatal) {
            task.status = TaskStatus.ERRORED;
        } else if (scanPath.error > 0 && scanPath.retryCount >= this.maxRetryCount) {
            task.status = TaskStatus.ERRORED;
        } else if (scanPath.retryCount > 0) {
            task.status = TaskStatus.COMPLETED_WITH_ERROR;
        } else {
            task.status = TaskStatus.COMPLETED;
        }

        if (scanPath.error > 0 || scanPath.isFatal) {
            const errorType = scanPath.isFatal ? ErrorType.FATAL_ERROR : 
                            scanPath.retryCount >= this.maxRetryCount ? ErrorType.TRANSIENT_ERROR : 
                            ErrorType.RECOVERABLE_ERROR;
            
            const errorMessages = Array.from(scanPath.errors);
            
            const dmErr = dmError("TASK", Origin.SOURCE, Operation.READ_DIR, errorType, task.id, undefined, undefined, {
                errorCode: errorMessages,
                message: scanPath.isFatal ? 
                    `Server connectivity failure: ${errorMessages.join('; ')}` :
                    `Task ${task.id} has ${scanPath.error} errors and ${scanPath.success} success during scan`
            });

            await jobContext.appendToErrorList(dmErr);
            
            if (scanPath.isFatal || errorType === ErrorType.TRANSIENT_ERROR) {
                task.status = TaskStatus.ERRORED;
                this.logger.error(`[${jobContext.jobRunId}] Task ${task.id} marked as ERRORED due to ${scanPath.isFatal ? 'fatal server error' : 'max retries exceeded'}`);
                jobContext.updatedTaskInfo.lastId = await jobContext.appendToUpdatedTaskList(task);
            } else if (scanPath.retryCount < this.maxRetryCount) {
                this.logger.debug(`[${jobContext.jobRunId}] Appending task ${task.id} to retry queue`);
                jobContext.tasksInfo.lastId = await jobContext.appendToTaskList(task);
            }
        } else {
            jobContext.updatedTaskInfo.lastId = await jobContext.appendToUpdatedTaskList(task);
        }

        await this.redisService.setJobContext(task.jobRunId, jobContext);
        return scanPath;
    }

    async scanDirCommand({ excludePatterns = [], jobContext, sourcePath, sourcePrefix, command, skipFile }: ScanDirCommandInput): Promise<ScanDirCommandOutput> {
        const scanDirOutput: ScanDirCommandOutput = {
            files: 0, 
            directory: 0, 
            isFatal: false, 
            error: undefined, 
            errorType: command.retryCount >= this.maxRetryCount ? ErrorType.TRANSIENT_ERROR : ErrorType.RECOVERABLE_ERROR,
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

                if (sourceStat.isSymbolicLink()) {
                    try {
                        const linkTarget = await fs.promises.readlink(sourceContentPath);
                        const resolvedTarget = path.resolve(path.dirname(sourceContentPath), linkTarget);
                        if (!fs.existsSync(resolvedTarget)) {
                            this.logger.debug(`[${jobContext.jobRunId}] Broken symbolic link: "${sourceContentPath}" → "${resolvedTarget}" (target does not exist)`);
                        }
                    } catch (err) {
                        this.logger.debug(`[${jobContext.jobRunId}] Error reading symbolic link: "${sourceContentPath}" (${err.message})`);
                    }
                } else if (!fs.existsSync(sourceContentPath)) {
                    this.logger.debug(`[${jobContext.jobRunId}] Skipping non-existent path: "${sourceContentPath}"`);
                    continue;
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
                    jobContext.dirsInfo.lastId = await jobContext.appendToDirList(fileInfo);
                    jobContext.dirsInfo.numMessages++;
                    scanDirOutput.directory++;
                } else {
                    scanDirOutput.files++;
                }

                jobContext.dirsInfo.lastId = await jobContext.appendToFileList(fileInfo);
                jobContext.dirsInfo.numMessages++;
            }

        } catch (error: any) {
            this.logger.error(`[${jobContext.jobRunId}] Error scanning directory1 ${sourcePath}: ${JSON.stringify(error)}`);
            this.logger.error(`[${jobContext.jobRunId}] Error scanning directory ${sourcePath}: ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`);
              
            const serverInfo = getServerInfoFromPath(sourcePath, jobContext);
            const isServerDown = isServerDownError(error);
  
            const errorType = isServerDown ? ErrorType.FATAL_ERROR : 
                             command.retryCount >= this.maxRetryCount ? ErrorType.TRANSIENT_ERROR : 
                             ErrorType.RECOVERABLE_ERROR;
            
            const errorMessage = isServerDown ? 
                createServerDownErrorMessage(error, serverInfo) : 
                error?.originalError || 'Unknown error';
            
            const dmErr = dmError("OPERATION", Origin.SOURCE, Operation.READ_DIR, errorType, command.commandId, error, {
                name: command.fPath,
                path: sourcePath,
            });

            jobContext.errorsInfo.lastId = await jobContext.appendToErrorList(dmErr);
            
            scanDirOutput.error = errorMessage;
            scanDirOutput.isFatal = isServerDown;
            scanDirOutput.errorType = errorType;
            
            this.logger.error(`[${jobContext.jobRunId}] ${isServerDown ? 'FATAL SERVER ERROR' : 'ERROR'}: ${errorMessage}`);
            
            if (isServerDown) {
                throw error;
            }
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