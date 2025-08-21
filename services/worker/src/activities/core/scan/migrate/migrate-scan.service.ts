import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cmd, CmdMeta, Command, CommandStatus, ErrorType, FileInfo, ItemMeta, JobManagerContext, MetaData, Operations, Ops, OPS_CMD, OPS_STATUS } from "@netapp-cloud-datamigrate/jobs-lib";
import { uuid4 } from "@temporalio/workflow";
import * as fs from "fs";
import * as path from "path";
import { dmError, getFileInfo, isContentUpdate, isMetaUpdated, removePrefix, shouldExcludeOrSkip } from "src/activities/utils/utils";
import { Operation, Origin } from "src/activities/utils/utils.types";
import { FatalError } from "src/errors/errors.types";
import { DirContentsInput, PublishCommandInput } from "./migrate-scan.type";
import { BatchSubDirOutput, ScanDirectoryInput, ScanDirectoryOutput } from "../scan-activity.type";
import { LoggerService, LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { batchSubDirs, isPathExists } from "../../utils/utils";

@Injectable()
export class MigrateScanService {
    readonly workerId: string;
    readonly maxMigrationCommand : number;
    readonly maxConcurrency: number;
    readonly maxRetryCount: number;
    private readonly logger: LoggerService;

    constructor(
        @Inject(ConfigService) 
        private readonly configService: ConfigService,
        @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    ) {
        this.workerId = this.configService.get<string>('worker.workerId');
        this.maxMigrationCommand = this.configService.get('worker.maxMigrationCommand') || 100;
        this.maxConcurrency = this.configService.get('worker.maxCommandConcurrency') || 100; 
        this.maxRetryCount = this.configService.get('worker.maxRetryCount') || 3;
        this.logger = loggerFactory.create(MigrateScanService.name);
    }


    async publishCommands({ jobContext, commands}: PublishCommandInput)  {
        await jobContext.publishBulkToCommandStream(commands);
    }

    async *getDirContentsStream({path, origin, jobContext, errorType, command, batchSize = 100}: DirContentsInput & {batchSize?: number}): AsyncGenerator<string[], void, unknown> {
        let dirHandle: fs.Dir | null = null;
        try {
            const pathExists = await isPathExists(path);
            if (!pathExists) {
                if (origin === Origin.SOURCE)  
                    throw new FatalError(`Source directory does not exist: ${path}`);
                return; // Return empty generator for non-existent target directories
            }
            
            console.log(`[MIGRATE-STREAM] Opening directory for batched streaming: ${path} (batch size: ${batchSize})`);
            dirHandle = await fs.promises.opendir(path);
            
            let entryCount = 0;
            let batch: string[] = [];
            
            for await (const dirent of dirHandle) {
                batch.push(dirent.name);
                entryCount++;
                
                // Log progress for very large directories
                if (entryCount % 10000 === 0) {
                    console.log(`[MIGRATE-STREAM] Processed ${entryCount} entries from ${path}`);
                }
                
                // Yield batch when it reaches the specified size
                if (batch.length >= batchSize) {
                    yield batch;
                    batch = []; // Clear batch for next iteration
                }
            }
            
            // Yield remaining items if any
            if (batch.length > 0) {
                yield batch;
            }
            
            console.log(`[MIGRATE-STREAM] Completed streaming ${entryCount} entries from ${path} in batches of ${batchSize}`);
            
        } catch(error) {
            console.error(`[MIGRATE-STREAM ERROR] Failed to stream directory ${path}: ${error.message}`);
            if(error instanceof FatalError) 
                errorType = ErrorType.FATAL_ERROR;
            const ndmError = dmError("OPERATION", origin, Operation.READ_DIR, errorType, command.id, error, {name: command.fPath, path: path});
            await jobContext.publishToErrorStream(ndmError);
            throw error; 
        } finally {
            if (dirHandle) {
                try {
                    await dirHandle.close();
                    console.log(`[MIGRATE-STREAM] Directory handle closed for: ${path}`);
                } catch (closeError) {
                    console.error(`[MIGRATE-STREAM] Error closing directory handle: ${closeError.message}`);
                }
            }
        }
    }

    // Keep the old method for compatibility/fallback, but mark as deprecated
    async getDirContents({path, origin, jobContext, errorType, command}: DirContentsInput): Promise<Set<string>>{
        let content = new Set<string>();
        try{
            const pathExists = await isPathExists(path);
            if (!pathExists) {
                if (origin === Origin.SOURCE)  
                    throw new FatalError(`Source directory does not exist: ${path}`);
                return content; 
            }
            content = new Set<string>( await fs.promises.readdir(path)); 
        }catch(error){
            if(error instanceof FatalError) 
                errorType = ErrorType.FATAL_ERROR;
            const ndmError = dmError("OPERATION", origin, Operation.READ_DIR, errorType, command.id, error, {name: command.fPath, path: path});
            await jobContext.publishToErrorStream(ndmError);
            throw error; 
        }
        return content;
    }

    
    async scanDirectory({ jobContext, sourcePath, sourcePrefix, targetPath , command, settings , targetPrefix, errorType}: ScanDirectoryInput): Promise<ScanDirectoryOutput> { 

        const output: ScanDirectoryOutput = { fileCount: 0, dirCount: 0, subDirs: [], batchDirs: []}
        let commands: Cmd[] = [];

        console.log(`[MIGRATE-SCAN] Starting streaming comparison scan: ${sourcePath} vs ${targetPath}`);
        
        // For very large directories, we'll use streaming comparison instead of loading all target content
        const targetPathExists = await isPathExists(targetPath);
        let processedCount = 0;
        
        // Stream through source directory in batches
        for await (const sourceBatch of this.getDirContentsStream({
            path: sourcePath, 
            origin: Origin.SOURCE, 
            jobContext, 
            errorType, 
            command,
            batchSize: 1000 // Optimal batch size for processing
        })) {
            try {
                // Process the entire batch in parallel
                const batchResults = await Promise.all(
                    sourceBatch.map(async (item) => {
                        try {
                            const sourceContentPath = path.join(sourcePath, item);
                            const sourceContentExists = await isPathExists(sourceContentPath);
                            if (!sourceContentExists) return null;
                            
                            const sourceStat = await fs.promises.lstat(sourceContentPath);
                            const relativeSourcePath = removePrefix(sourceContentPath, sourcePrefix);
                            
                            if (shouldExcludeOrSkip({
                                fullPath: sourceContentPath,
                                stats: sourceStat,
                                excludePatterns: settings.excludePatterns,
                                skipTime: settings.skipFile,
                                olderThan: new Date(jobContext.jobConfig.options?.excludeOlderThan),
                                jobType: jobContext.jobConfig.jobType
                            })) return null;

                            const fileInfo: FileInfo = await getFileInfo({
                                name: item, 
                                fullFilePath: sourceContentPath, 
                                relativePath: relativeSourcePath
                            });

                            // Check if item exists in target (streaming approach - one file check at a time)
                            const targetFilePath = path.join(targetPath, item);
                            let existsInTarget = false;
                            let targetStat: fs.Stats | null = null;
                            
                            if (targetPathExists) {
                                try {
                                    const targetFileExists = await isPathExists(targetFilePath);
                                    if (targetFileExists) {
                                        existsInTarget = true;
                                        const targetStatLstat = await fs.promises.lstat(targetFilePath);
                                        if (targetStatLstat.isSymbolicLink()) {
                                            targetStat = targetStatLstat;
                                        } else {
                                            targetStat = await fs.promises.stat(targetFilePath);
                                        }
                                    }
                                } catch (targetError) {
                                    // Target file might have permission issues, treat as non-existent
                                    existsInTarget = false;
                                }
                            }

                            return {
                                item,
                                sourceContentPath,
                                sourceStat,
                                relativeSourcePath,
                                fileInfo,
                                existsInTarget,
                                targetStat
                            };
                        } catch (error) {
                            this.logger.error(`Error processing item ${item} in batch: ${error}`);
                            return null;
                        }
                    })
                );

                // Filter out failed items
                const validItems = batchResults.filter(result => result !== null);
                processedCount += validItems.length;
                
                console.log(`[MIGRATE-SCAN] Processing batch of ${validItems.length} items (total processed: ${processedCount})`);

                // Process each valid item
                for (const itemResult of validItems) {
                    const { item, sourceStat, relativeSourcePath, fileInfo, existsInTarget, targetStat } = itemResult;
                    
                    if (sourceStat.isDirectory() && !sourceStat.isSymbolicLink()) {
                        output.dirCount++;
                        output.subDirs.push(relativeSourcePath);
                        if(output.subDirs.length >= 200 ){
                            const { batchDirs, subDirs }: BatchSubDirOutput = await batchSubDirs({subDirs: output.subDirs, batchSize: 200, jobContext});                            
                            output.batchDirs.push(...batchDirs);
                        }
                        this.logger.debug(`Scan Path ${relativeSourcePath} | parent ${sourcePath}`);
                        
                        if (!existsInTarget) {
                            const command = this.buildCommand(sourceStat, fileInfo.path);
                            if (command) commands.push(command);
                        }
                    } 
                    else if (sourceStat.isSymbolicLink()) {
                        if (!existsInTarget) {
                            const command = this.buildCommand(sourceStat, fileInfo.path);
                            if (command) commands.push(command);
                        }
                    }
                    else if (!existsInTarget) {
                        output.fileCount++;
                        const command = this.buildCommand(sourceStat, fileInfo.path);
                        if (command) commands.push(command);
                    } else {
                        // Item exists in both source and target - compare them
                        if (targetStat) {
                            const command = this.buildCommand(sourceStat, fileInfo.path, targetStat);
                            if (command) commands.push(command);
                        }
                    }

                    // Publish commands in chunks
                    if (commands.length >= this.maxMigrationCommand) {
                        const chunk = commands.splice(0, this.maxMigrationCommand);
                        await this.publishCommands({ jobContext, commands: chunk });
                    }
                }

                // Add small delay every 10 batches to prevent overwhelming the system
                if (Math.floor(processedCount / 100) % 10 === 0) {
                    await new Promise(resolve => setImmediate(resolve));
                }

            } catch (batchError) {
                this.logger.error(`Error processing batch in directory ${sourcePath}: ${batchError}`);
                const dmErr = dmError("OPERATION", Origin.SOURCE, Operation.READ_DIR, errorType, command.id, batchError, {name: command.fPath, path: sourcePath});
                await jobContext.publishToErrorStream(dmErr);
                // Continue with next batch instead of failing entire scan
                continue;
            }
        }
        
        // Handle deletion processing if enabled (this also needs streaming approach)
        if (jobContext?.jobConfig?.skipDelete === false && targetPathExists) {
            await this.processDeletedItemsStreamingComparison({
                sourcePath,
                targetPath,
                targetPrefix,
                jobContext,
                errorType,
                command,
                commands
            });
        }
        
        // Publish remaining commands
        if (commands.length > 0) {
            await this.publishCommands({ jobContext, commands: commands });
            commands = [];
        }
        
        console.log(`[MIGRATE-SCAN] Completed scan. Total processed: ${processedCount}, Files: ${output.fileCount}, Dirs: ${output.dirCount}`);
        
        return output;
    }


    async processDeletedItems({ sourceContent, targetContent, targetPath, targetPrefix, jobContext, errorType, command, commands }: {
        sourceContent: Set<string>,
        targetContent: Set<string>,
        targetPath: string,
        targetPrefix: string,
        jobContext: JobManagerContext,
        errorType: ErrorType,
        command: Cmd,
        commands: Cmd[]
    }) {
        for (const targetItem of targetContent) {
            if (!sourceContent.has(targetItem)) {
                const targetContentPath = path.join(targetPath, targetItem);
                try {
                    const targetContentExists = await isPathExists(targetContentPath);
                    if (targetContentExists) {
                        const targetStat = await fs.promises.lstat(targetContentPath);
                        const relativeSourcePath = removePrefix(targetContentPath, targetPrefix);
                        const deleteCommand = this.buildCommand(null, relativeSourcePath, targetStat);
                        if (deleteCommand) {
                            commands.push(deleteCommand);
                        }
                    }
                    if (commands.length >= this.maxMigrationCommand) {
                        const chunk = commands.splice(0, this.maxMigrationCommand);
                        await this.publishCommands({ jobContext, commands: chunk });
                    }
                } catch (error) {
                    this.logger.error(`[${jobContext.jobRunId}] Error processing  ${targetContentPath}: ${error}`);
                    const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.READ_DIR, errorType, command.id, error, { name: command.fPath, path: targetPath });
                    await jobContext.publishToErrorStream(dmErr);
                    throw error;
                }
            }
        }
    }

    async processDeletedItemsStreaming({ 
        targetContent, 
        targetPath, 
        targetPrefix, 
        jobContext, 
        errorType, 
        command, 
        commands 
    }: {
        targetContent: Set<string>,
        targetPath: string,
        targetPrefix: string,
        jobContext: JobManagerContext,
        errorType: ErrorType,
        command: Cmd,
        commands: Cmd[]
    }) {
        console.log(`[MIGRATE-SCAN] Processing deletions for ${targetContent.size} target items`);
        
        // Convert target content set to array and process in batches
        const targetItems = Array.from(targetContent);
        const batchSize = 100;
        
        for (let i = 0; i < targetItems.length; i += batchSize) {
            const batch = targetItems.slice(i, i + batchSize);
            
            try {
                // Process deletion batch in parallel
                const deletionResults = await Promise.all(
                    batch.map(async (targetItem) => {
                        try {
                            const targetContentPath = path.join(targetPath, targetItem);
                            const targetContentExists = await isPathExists(targetContentPath);
                            
                            if (targetContentExists) {
                                const targetStat = await fs.promises.lstat(targetContentPath);
                                const relativeSourcePath = removePrefix(targetContentPath, targetPrefix);
                                const deleteCommand = this.buildCommand(null, relativeSourcePath, targetStat);
                                return deleteCommand;
                            }
                            return null;
                        } catch (error) {
                            this.logger.error(`[${jobContext.jobRunId}] Error processing deletion for ${targetItem}: ${error}`);
                            return null;
                        }
                    })
                );

                // Add valid deletion commands
                const validDeletions = deletionResults.filter(cmd => cmd !== null);
                commands.push(...validDeletions);

                // Publish commands in chunks
                while (commands.length >= this.maxMigrationCommand) {
                    const chunk = commands.splice(0, this.maxMigrationCommand);
                    await this.publishCommands({ jobContext, commands: chunk });
                }

                // Add small delay every few batches
                if ((i / batchSize) % 10 === 0) {
                    await new Promise(resolve => setImmediate(resolve));
                }

            } catch (batchError) {
                this.logger.error(`[${jobContext.jobRunId}] Error processing deletion batch: ${batchError}`);
                const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.READ_DIR, errorType, command.id, batchError, { 
                    name: command.fPath, 
                    path: targetPath 
                });
                await jobContext.publishToErrorStream(dmErr);
                // Continue with next batch instead of failing
                continue;
            }
        }
        
        console.log(`[MIGRATE-SCAN] Completed deletion processing`);
    }

    async processDeletedItemsStreamingComparison({ 
        sourcePath,
        targetPath, 
        targetPrefix, 
        jobContext, 
        errorType, 
        command, 
        commands 
    }: {
        sourcePath: string,
        targetPath: string,
        targetPrefix: string,
        jobContext: JobManagerContext,
        errorType: ErrorType,
        command: Cmd,
        commands: Cmd[]
    }) {
        console.log(`[MIGRATE-SCAN] Processing deletions using streaming comparison`);
        
        let deletionCount = 0;
        
        // Stream through target directory to find items that don't exist in source
        for await (const targetBatch of this.getDirContentsStream({
            path: targetPath,
            origin: Origin.DESTINATION,
            jobContext,
            errorType,
            command,
            batchSize: 100
        })) {
            try {
                // Check each target item against source in parallel
                const deletionResults = await Promise.all(
                    targetBatch.map(async (targetItem) => {
                        try {
                            // Check if this target item exists in source
                            const sourceFilePath = path.join(sourcePath, targetItem);
                            const sourceExists = await isPathExists(sourceFilePath);
                            
                            if (!sourceExists) {
                                // Item exists in target but not in source - candidate for deletion
                                const targetContentPath = path.join(targetPath, targetItem);
                                const targetContentExists = await isPathExists(targetContentPath);
                                
                                if (targetContentExists) {
                                    const targetStat = await fs.promises.lstat(targetContentPath);
                                    const relativeSourcePath = removePrefix(targetContentPath, targetPrefix);
                                    const deleteCommand = this.buildCommand(null, relativeSourcePath, targetStat);
                                    return deleteCommand;
                                }
                            }
                            return null;
                        } catch (error) {
                            this.logger.error(`[${jobContext.jobRunId}] Error checking deletion for ${targetItem}: ${error}`);
                            return null;
                        }
                    })
                );

                // Add valid deletion commands
                const validDeletions = deletionResults.filter(cmd => cmd !== null);
                commands.push(...validDeletions);
                deletionCount += validDeletions.length;

                // Publish commands in chunks
                while (commands.length >= this.maxMigrationCommand) {
                    const chunk = commands.splice(0, this.maxMigrationCommand);
                    await this.publishCommands({ jobContext, commands: chunk });
                }

                // Add small delay every few batches
                if (deletionCount > 0 && deletionCount % 1000 === 0) {
                    await new Promise(resolve => setImmediate(resolve));
                }

            } catch (batchError) {
                this.logger.error(`[${jobContext.jobRunId}] Error processing deletion batch: ${batchError}`);
                const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.READ_DIR, errorType, command.id, batchError, { 
                    name: command.fPath, 
                    path: targetPath 
                });
                await jobContext.publishToErrorStream(dmErr);
                // Continue with next batch instead of failing
                continue;
            }
        }
        
        console.log(`[MIGRATE-SCAN] Completed deletion processing. Found ${deletionCount} items to delete`);
    }

    buildCommand = (sFile: fs.Stats | undefined, fPath: string, dFile?: fs.Stats): Cmd | undefined => {

        if (!sFile) {
            const isDirectory = dFile ? dFile.isDirectory() : false;
            return new Cmd(
                uuid4(),
                fPath,
                CommandStatus.READY,
                isDirectory,
                {
                    [isDirectory ? OPS_CMD.REMOVE_DIR : OPS_CMD.REMOVE_FILE]:
                        { status: OPS_STATUS.READY, params: {} }
                }
            )
        }
        const metadata: CmdMeta = {
            size: sFile.size,
            mtime: sFile.mtime,
            mode: sFile.mode,
            uid: sFile.uid,
            gid: sFile.gid,
            atime: sFile.atime,
            ctime: sFile.ctime,
            birthtime: sFile.birthtime,
            sid: undefined,
            isSymLink: sFile.isSymbolicLink() ? true : false
        }

        if (isContentUpdate(sFile, dFile)) {
            const isDirectory = sFile.isDirectory();
            return new Cmd(
                uuid4(),
                fPath,
                CommandStatus.READY,
                isDirectory,
                {
                    [isDirectory ? OPS_CMD.COPY_DIR : OPS_CMD.COPY_FILE]: { status: OPS_STATUS.READY, params: {} },
                    [OPS_CMD.STAMP_META]: { status: OPS_STATUS.READY, params: {} }
                },
                metadata,
            )
        }
      

        if (isMetaUpdated(sFile, dFile, 5000)) {
            const isDirectory = sFile.isDirectory();
            return new Cmd(
                uuid4(),
                fPath,
                CommandStatus.READY,
                isDirectory,
                {
                    [isDirectory ? OPS_CMD.COPY_DIR : OPS_CMD.COPY_FILE]: { status: OPS_STATUS.COMPLETED , params: {} },
                    [OPS_CMD.STAMP_META]: { status: OPS_STATUS.READY, params: {} }
                },
                metadata,
            )
        }
        return undefined;
    }
}
