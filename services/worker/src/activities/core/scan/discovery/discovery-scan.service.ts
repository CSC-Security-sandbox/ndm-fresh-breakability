import { Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cmd, ErrorType, FileInfo, JobManagerContext, ItemInfo, ItemMeta } from "@netapp-cloud-datamigrate/jobs-lib";
import * as fs from 'fs';
import * as path from 'path';
import { dmError, getFilePermissions, getFileType, removePrefix, shouldExcludeOrSkip, checkCaseSensitiveConflict } from "src/activities/utils/utils";
import { Operation, Origin } from "src/activities/utils/utils.types";
import { FatalError } from "src/errors/errors.types";
import { DirContentsInput, PublishItemInfoInput } from "./discovery-scan.type";
import { ScanDirectoryInput, ScanDirectoryOutput } from "../scan-activity.type";
import { isPathExists } from "../../utils/utils";
import { LoggerService, LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { FileType } from "src/activities/types/tasks";
import { FileTypeDetectionService } from '../../utils/file-type-detection.service';
import { WinOperationService } from '../../migrate/command-execution/win-opeartions/win-operation.service';
import { platform } from "os";


export class DiscoveryScanService {
    readonly workerId: string;
    readonly maxConcurrency: number;
    readonly maxRetryCount: number;
    private readonly logger: LoggerService;

    constructor(
        @Inject(ConfigService) 
        private readonly configService: ConfigService,
        @Inject(LoggerFactory) loggerFactory: LoggerFactory,
        private readonly fileTypeDetectionService: FileTypeDetectionService,
        private readonly winOperationService: WinOperationService,
    ) {
        this.workerId = this.configService.get<string>('worker.workerId');
        this.maxConcurrency = this.configService.get('worker.maxCommandConcurrency') || 100; 
        this.maxRetryCount = this.configService.get('worker.maxRetryCount') || 3; 
        this.logger = loggerFactory.create(DiscoveryScanService.name);  
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
        const isSMB = process.platform === 'win32';
        const lowerCaseSourceDirs = new Set<string>();
        try {
            for (const item of sourceContent) {
                const sourceContentPath = path.join(sourcePath, item.name);
                // Get basic file stats (size, timestamps, permissions)
                // Note: lstat does NOT include ADS information - we detect that separately
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
                const fileType = await this.fileTypeDetectionService.detectFileType(sourceContentPath, sourceStat);
                this.logger.debug(`FileType for path ${sourceContentPath} is ${fileType}`);

                // Publish main file/directory
                await this.publishFileInfo({
                    stats: sourceStat, command, jobContext, fPath: sourceContentPath, relativeSourcePath, fileType
                });
                
                // Detect and publish ADS streams for files
                await this.publishADSStreams({
                        stats: sourceStat,command,jobContext,fPath: sourceContentPath,relativeSourcePath
                });
                

                if (sourceStat.isDirectory()) {
                    if(sourceStat.isSymbolicLink() ) continue;
                    output.dirCount++;
                    if (fileType === FileType.VOLUME_MOUNT_POINT) continue;
                    if (isSMB){
                        const hasConflict = await checkCaseSensitiveConflict(
                            jobContext.jobConfig.jobType,
                            item.name,
                            lowerCaseSourceDirs,
                            relativeSourcePath,
                            sourceContentPath,
                            command,
                            jobContext
                        );
                        if (hasConflict) continue;
                    }
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
    
    
    async publishFileInfo({ jobContext, stats, fPath, relativeSourcePath, fileType }: PublishItemInfoInput): Promise<void> {
        const isDirectory = stats.isDirectory();
        const sourceMeta: ItemMeta = {
            accessTime: stats.atime,
            birthTime: stats.birthtime,
            modifiedTime: stats.mtime,
            permission: getFilePermissions(stats, isDirectory),
        };

        const itemInfo = new ItemInfo(
            relativeSourcePath,
            isDirectory,
            stats.isSymbolicLink(),
            relativeSourcePath.split('/').length - 2,
            path.extname(fPath),
            fileType,
            sourceMeta,
            sourceMeta,
            stats.size,
            stats.ino,
            false
        );

        await jobContext.publishToFileStream(itemInfo);
    }

    /**
     * Detect and publish ADS streams as separate inventory items
     * Each stream is published with fileName format: "file.txt:StreamName"
     */
    async publishADSStreams({ jobContext, stats, fPath, relativeSourcePath }: PublishItemInfoInput): Promise<void> {
        if (process.platform !== 'win32') {
            return; // ADS only applicable on Windows
        }
        try {
            const adsInfo = await this.winOperationService.detectADSInfo(fPath);
            
            if (!adsInfo.hasADS) {
                return; // No streams to publish
            }
            
            this.logger.debug(`File ${relativeSourcePath} has ${adsInfo.streamCount} ADS: ${adsInfo.streamNames.join(', ')}`);
            
            // Publish each stream as a separate inventory item
            for (let i = 0; i < adsInfo.streamNames.length; i++) {
                const streamName = adsInfo.streamNames[i];
                const streamSize = adsInfo.streamSizes[i];
                
                const sourceMeta: ItemMeta = {
                    accessTime: stats.atime,
                    birthTime: stats.birthtime,
                    modifiedTime: stats.mtime,
                    permission: getFilePermissions(stats, false),
                };
                
                const streamItemInfo = new ItemInfo(
                    `${relativeSourcePath}:${streamName}`,  // Format: "folder/file.txt:StreamName"
                    false,  // Not a directory
                    false,  // Not a symlink
                    relativeSourcePath.split('/').length - 2,  // Same depth as parent file
                    '',  // No extension for streams
                    FileType.STREAM,  // New file type for ADS streams
                    sourceMeta,
                    sourceMeta,
                    streamSize,  // Individual stream size
                    stats.ino, // Same inode as parent file
                    false 
                );
                
                await jobContext.publishToFileStream(streamItemInfo);
            }
        } catch (error) {
            // Don't fail discovery if ADS detection fails - log warning and continue
            this.logger.warn(`Failed to detect ADS for ${relativeSourcePath}: ${error.message}`);
        }
    }


    // Detect File type using special Windows link types
    private async detectFileType(sourceContentPath: string, sourceStat: fs.Stats): Promise<FileType> {
        let symlinkType: FileType | undefined;
        if (process.platform === 'win32') {
            // Check if symbolic link or directory (to detect junctions and volume mount points)
            if (sourceStat.isSymbolicLink() || sourceStat.isDirectory()) {
                try {
                    // Detect detailed link type (junction, volume mount point, symbolic link)
                    const linkInfo = await this.winOperationService.detectSymbolicLinkType(sourceContentPath);
                    if (linkInfo === FileType.VOLUME_MOUNT_POINT) {
                        symlinkType = FileType.VOLUME_MOUNT_POINT;
                        this.logger.debug(`Detected volume mount point for ${sourceContentPath}`);
                    } else if (linkInfo === FileType.JUNCTION) {
                        symlinkType = FileType.JUNCTION;
                        this.logger.debug(`Detected junction for ${sourceContentPath}`);
                    } else if (linkInfo === FileType.SYMBOLIC_LINK) {
                        symlinkType = FileType.SYMBOLIC_LINK;
                        this.logger.debug(`Detected symbolic link for ${sourceContentPath}`);
                    } else {
                        symlinkType = FileType.UNKNOWN;
                        this.logger.debug(`Detected unknown link type for ${sourceContentPath}`);
                    }
                } catch (error) {
                    this.logger.error(`Failed to detect link type for ${sourceContentPath}: ${error.message}`);
                    throw error;
                }
            } else if (!sourceStat.isDirectory() && path.extname(sourceContentPath).toLowerCase() === '.lnk') {
                symlinkType = FileType.SHORTCUT;
                this.logger.debug(`Detected shortcut for ${sourceContentPath}`);
            }
        }

        const fileType = (symlinkType && symlinkType !== FileType.UNKNOWN)
            ? symlinkType
            : getFileType(sourceStat, sourceStat.isDirectory());
        
        return fileType;
    }

}
