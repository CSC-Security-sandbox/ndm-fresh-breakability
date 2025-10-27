import { Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ErrorType, FileInfo, ItemInfo, ItemMeta } from "@netapp-cloud-datamigrate/jobs-lib";
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { dmError, getFileInfo, getFilePermissions, getFileType, removePrefix, shouldExcludeOrSkip } from "src/activities/utils/utils";
import { Operation, Origin } from "src/activities/utils/utils.types";
import { FatalError } from "src/errors/errors.types";
import { DirContentsInput, PublishItemInfoInput } from "./discovery-scan.type";
import { ScanDirectoryInput, ScanDirectoryOutput } from "../scan-activity.type";
import { isPathExists } from "../../utils/utils";

export interface StreamInfo {
    filePath: string;
    streamName: string;
    streamPath: string; // format: "filePath:streamName"
    size: number;
    type: string;
}


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


    async getDirContents({path, jobContext, errorType, command}: DirContentsInput): Promise<fs.Dirent[]>{
        let content:fs.Dirent[] = [];
        try{
            const pathExists = await isPathExists(path);
            if (!pathExists) 
                    throw new FatalError(`Source directory does not exist: ${path}`);
            content = await fs.promises.readdir(path,{ withFileTypes: true }); 
        }catch(error){
            if(error instanceof FatalError) 
                errorType = ErrorType.FATAL_ERROR;
            const ndmError = dmError("OPERATION", Origin.SOURCE, Operation.READ_DIR, errorType, command.id, error, {name: command.fPath, path: path});
            await jobContext.publishToErrorStream(ndmError);
            throw error; 
        }
        return content;
    }

    async scanDirectory({ jobContext, sourcePath, sourcePrefix, command, settings, errorType}: ScanDirectoryInput): Promise<ScanDirectoryOutput> {
        const output: ScanDirectoryOutput = { fileCount: 0, dirCount: 0, subDirs: []}
        const sourceContent = await this.getDirContents({path: sourcePath, jobContext, errorType, command});
        try {
            for (const item of sourceContent) {
                const sourceContentPath = path.join(sourcePath, item.name);
                const sourceStat: fs.Stats = await fs.promises.lstat(sourceContentPath);
                
                if (shouldExcludeOrSkip({
                    fullPath: sourceContentPath,
                    stats: sourceStat,
                    excludePatterns: settings.excludePatterns,
                    skipTime: settings.skipFile,
                    olderThan: new Date(jobContext.jobConfig.options?.excludeOlderThan),
                    jobType: jobContext.jobConfig.jobType
                })) continue;

                const relativeSourcePath = removePrefix(sourceContentPath, sourcePrefix);
                await this.publishFileInfo({
                    stats: sourceStat, command, jobContext, fPath: sourceContentPath, relativeSourcePath
                });
                
                if (sourceStat.isDirectory()) {
                    if(sourceStat.isSymbolicLink()) continue;
                    output.dirCount++;
                    output.subDirs.push(relativeSourcePath);
                } else output.fileCount++;
            }
        }catch(error) {
            const dmErr = dmError("OPERATION", Origin.SOURCE, Operation.READ_DIR, errorType, command.id, error, {name: command.fPath, path: sourcePath});
            await jobContext.publishToErrorStream(dmErr);
            throw error; 
        }
        return output;
    }
    
    /**
     * Discover NTFS alternate data streams using Windows dir command
     */
    async discoverStreams(filePath: string): Promise<StreamInfo[]> {
        const streams: StreamInfo[] = [];

        try {
            // Use dir /r to show alternate data streams
            const command = `dir /r "${filePath}"`;
            const output = execSync(command, { encoding: 'utf8', windowsHide: true });
            
            // Parse the output to find streams
            const lines = output.split('\n');
            for (const line of lines) {
                // Look for lines with stream format: filename:streamname:$DATA
                const streamMatch = line.match(/\s+(\d+)\s+([^:]+):([^:]+):\$DATA/);
                if (streamMatch) {
                    const size = parseInt(streamMatch[1]);
                    const streamName = streamMatch[3];
                    
                    streams.push({
                        filePath,
                        streamName,
                        streamPath: `${filePath}:${streamName}`,
                        size,
                        type: 'DATA'
                    });
                }
            }
        } catch (error) {
            // Failed to discover streams with dir command, continue silently
        }

        return streams;
    }
    
    
    async publishFileInfo({jobContext, stats, fPath, relativeSourcePath}: PublishItemInfoInput): Promise<void> {
            const isDirectory = stats.isDirectory();
            const sourceMeta: ItemMeta = {
                accessTime: stats.atime,
                birthTime: stats.birthtime,
                modifiedTime: stats.mtime,
                permission: getFilePermissions(stats, isDirectory),
            }
            
            // Publish the main file/directory
            const itemInfo = new ItemInfo(
                relativeSourcePath,
                isDirectory,
                stats.isSymbolicLink(),
                relativeSourcePath.split('/').length - 2,
                path.extname(fPath),
                getFileType(stats, isDirectory),
                sourceMeta,
                sourceMeta,
                stats.size,
                stats.ino
            )
            await jobContext.publishToFileStream(itemInfo);

            // Discover and publish NTFS streams for both files and directories (not symbolic links)
            if (!stats.isSymbolicLink()) {
                try {
                    const streams = await this.discoverStreams(fPath);
                    
                    for (const stream of streams) {
                        // Create ItemInfo for the stream with path format "filePath:streamName"
                        const streamRelativePath = `${relativeSourcePath}:${stream.streamName}`;
                        const streamMeta: ItemMeta = {
                            accessTime: stats.atime, // Use parent item times
                            birthTime: stats.birthtime,
                            modifiedTime: stats.mtime,
                            permission: getFilePermissions(stats, false), // Streams are like files
                        }
                        
                        const streamItemInfo = new ItemInfo(
                            streamRelativePath,
                            false, // Streams are not directories
                            false, // Streams are not symbolic links
                            relativeSourcePath.split('/').length - 2, // Same depth as parent item
                            '', // Streams don't have extensions
                            'FILE', // Treat streams as files
                            streamMeta,
                            streamMeta,
                            stream.size,
                            stats.ino // Use parent item inode
                        )
                        
                        await jobContext.publishToFileStream(streamItemInfo);
                    }
                } catch (error) {
                    // Stream discovery failed, continue with main item processing
                    // Don't throw error to avoid disrupting the main discovery workflow
                }
            }
        }

}
