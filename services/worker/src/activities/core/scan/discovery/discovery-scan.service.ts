import { Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ErrorType, FileInfo, ItemInfo, ItemMeta } from "@netapp-cloud-datamigrate/jobs-lib";
import * as fs from 'fs';
import * as path from 'path';
import { dmError, getFileInfo, getFilePermissions, getFileType, removePrefix, shouldExcludeOrSkip } from "src/activities/utils/utils";
import { Operation, Origin } from "src/activities/utils/utils.types";
import { FatalError } from "src/errors/errors.types";
import { DirContentsInput, PublishItemInfoInput } from "./discovery-scan.type";
import { ScanDirectoryInput, ScanDirectoryOutput } from "../scan-activity.type";
import { batchSubDirs, isPathExists } from "../../utils/utils";
import { executeBatchScan } from "src/workflows/core/child/child-scan.workflow";


export class DiscoveryScanService {
    readonly workerId: string;
    readonly maxConcurrency: number;
    readonly maxRetryCount: number;

     constructor(
        @Inject(ConfigService) 
        private readonly configService: ConfigService,
    ) {
        this.workerId = this.configService.get<string>('worker.workerId');
        this.maxConcurrency = this.configService.get('worker.maxCommandConcurrency') || 100; 
        this.maxRetryCount = this.configService.get('worker.maxRetryCount') || 3;  
    }


    async *getDirContentsStream({path, jobContext, errorType, command, batchSize = 100}: DirContentsInput & {batchSize?: number}): AsyncGenerator<fs.Dirent[], void, unknown> {
        let dirHandle: fs.Dir | null = null;
        try {
            const pathExists = await isPathExists(path);
            if (!pathExists) 
                throw new FatalError(`Source directory does not exist: ${path}`);
            
            console.log(`[STREAM] Opening directory for batched streaming: ${path} (batch size: ${batchSize})`);
            dirHandle = await fs.promises.opendir(path);
            
            let entryCount = 0;
            let batch: fs.Dirent[] = [];
            
            for await (const dirent of dirHandle) {
                batch.push(dirent);
                entryCount++;
                
                // Log progress for very large directories
                if (entryCount % 10000 === 0) {
                    console.log(`[STREAM] Processed ${entryCount} entries from ${path}`);
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
            
            console.log(`[STREAM] Completed streaming ${entryCount} entries from ${path} in batches of ${batchSize}`);
            
        } catch(error) {
            console.error(`[STREAM ERROR] Failed to stream directory ${path}: ${error.message}`);
            if(error instanceof FatalError) 
                errorType = ErrorType.FATAL_ERROR;
            const ndmError = dmError("OPERATION", Origin.SOURCE, Operation.READ_DIR, errorType, command.id, error, {name: command.fPath, path: path});
            await jobContext.publishToErrorStream(ndmError);
            throw error; 
        } finally {
            if (dirHandle) {
                try {
                    await dirHandle.close();
                    console.log(`[STREAM] Directory handle closed for: ${path}`);
                } catch (closeError) {
                    console.error(`[STREAM] Error closing directory handle: ${closeError.message}`);
                }
            }
        }
    }

    async scanDirectory({ jobContext, sourcePath, sourcePrefix, command, settings, errorType}: ScanDirectoryInput): Promise<ScanDirectoryOutput> {
        const output: ScanDirectoryOutput = { fileCount: 0, dirCount: 0, subDirs: [], batchDirs: [] }
        
        try {
            let processedCount = 0;
            console.log(`[SCAN] Starting batched streaming scan for: ${sourcePath}`);
            
            // Use batched streaming directory reading for better performance
            for await (const dirents of this.getDirContentsStream({
                path: sourcePath, 
                jobContext, 
                errorType, 
                command,
                batchSize: 100 // Process 100 items per batch from the stream
            })) {
                try {
                    // Process entire batch of dirents
                    const batchWithStats = await Promise.all(
                        dirents.map(async (item) => {
                            try {
                                const sourceContentPath = path.join(sourcePath, item.name);
                                const sourceStat = await fs.promises.lstat(sourceContentPath);
                                return { item, sourceContentPath, sourceStat };
                            } catch (statError) {
                                console.error(`[SCAN] Error getting stats for ${item.name}: ${statError.message}`);
                                return null;
                            }
                        })
                    );
                    
                    // Filter out failed stat operations
                    const validBatch = batchWithStats.filter(item => item !== null) as { item: fs.Dirent, sourceContentPath: string, sourceStat: fs.Stats }[];
                    
                    if (validBatch.length > 0) {
                        processedCount += validBatch.length;
                        console.log(`[SCAN] Processing batch of ${validBatch.length} items (total processed: ${processedCount})`);
                        
                        await this.processBatch(validBatch, sourcePrefix, jobContext, command, settings, output);
                        
                        // Add small delay every 10 batches to prevent overwhelming the system
                        if (Math.floor(processedCount / 100) % 10 === 0) {
                            await new Promise(resolve => setImmediate(resolve));
                        }
                    }
                    
                } catch (batchError) {
                    console.error(`[SCAN] Error processing batch: ${batchError.message}`);
                    // Continue with next batch instead of failing entire scan
                    continue;
                }
            }
            
            console.log(`[SCAN] Completed scan. Total processed: ${processedCount}, Files: ${output.fileCount}, Dirs: ${output.dirCount}`);
            
        } catch(error) {
            console.error(`[SCAN] Error during directory scan: ${error.message}`);
            const dmErr = dmError("OPERATION", Origin.SOURCE, Operation.READ_DIR, errorType, command.id, error, {name: command.fPath, path: sourcePath});
            await jobContext.publishToErrorStream(dmErr);
            throw error; 
        }
        
        return output;
    }

    private async processBatch(
        batch: { item: fs.Dirent, sourceContentPath: string, sourceStat: fs.Stats }[],
        sourcePrefix: string,
        jobContext: any,
        command: any,
        settings: any,
        output: ScanDirectoryOutput
    ): Promise<void> {
        try {
            // Process items in parallel with controlled concurrency
            const concurrencyLimit = 10;
            const chunks = [];
            
            // Split batch into smaller chunks for parallel processing
            for (let i = 0; i < batch.length; i += concurrencyLimit) {
                chunks.push(batch.slice(i, i + concurrencyLimit));
            }
            
            for (const chunk of chunks) {
                await Promise.all(chunk.map(async ({ item, sourceContentPath, sourceStat }) => {
                    try {
                        if (shouldExcludeOrSkip({
                            fullPath: sourceContentPath,
                            stats: sourceStat,
                            excludePatterns: settings.excludePatterns,
                            skipTime: settings.skipFile,
                            olderThan: new Date(jobContext.jobConfig.options?.excludeOlderThan),
                            jobType: jobContext.jobConfig.jobType
                        })) return;

                        const relativeSourcePath = removePrefix(sourceContentPath, sourcePrefix);
                        
                        // Publish file info immediately to avoid memory accumulation
                        await this.publishFileInfo({
                            stats: sourceStat, 
                            command, 
                            jobContext, 
                            fPath: sourceContentPath, 
                            relativeSourcePath
                        });
                        
                        if (sourceStat.isDirectory()) {
                            if (!sourceStat.isSymbolicLink()) {
                                output.dirCount++;                                
                                output.subDirs.push(relativeSourcePath);
                                console.log(`Current subDirs length : ${output.subDirs.length}`);
                                if(output.subDirs.length >= 200){
                                    const result = await batchSubDirs({ subDirs: output.subDirs,jobContext, batchSize: 100 });
                                    console.log(`batched subDirs length : ${result.batchDirs.length}`);
                                    output.batchDirs.push(...result.batchDirs);
                                }
                                
                            }
                        } else {
                            output.fileCount++;
                        }
                    } catch (itemError) {
                        console.error(`[SCAN] Error processing item ${item.name}: ${itemError.message}`);
                        // Continue with other items
                    }
                }));
            }
        } catch (batchError) {
            console.error(`[SCAN] Error processing batch: ${batchError.message}`);
            throw batchError;
        }
    }
    
    
    async publishFileInfo({jobContext, stats, fPath, relativeSourcePath}: PublishItemInfoInput): Promise<void> {
            const isDirectory = stats.isDirectory();
            const sourceMeta: ItemMeta = {
                accessTime: stats.atime,
                birthTime: stats.birthtime,
                modifiedTime: stats.mtime,
                permission: getFilePermissions(stats, isDirectory),
            }
            const itemInfo = new ItemInfo(
                relativeSourcePath,
                isDirectory,
                stats.isSymbolicLink(),
                relativeSourcePath.split('/').length - 2,
                path.extname(fPath),
                getFileType(stats, isDirectory),
                sourceMeta,
                sourceMeta,
                stats.size
            )
            await jobContext.publishToFileStream(itemInfo);
        }

}

