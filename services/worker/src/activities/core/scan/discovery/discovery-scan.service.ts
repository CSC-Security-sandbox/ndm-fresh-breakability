import { Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cmd, ErrorType, FileInfo, JobManagerContext, ItemInfo, ItemMeta } from "@netapp-cloud-datamigrate/jobs-lib";
import * as fs from 'fs';
import * as path from 'path';
import { dmError, getFilePermissions, removePrefix, shouldExcludeOrSkip, checkCaseSensitiveConflict } from "src/activities/utils/utils";
import { Operation, Origin } from "src/activities/utils/utils.types";
import { FatalError } from "src/errors/errors.types";
import { DirContentsInput, PublishItemInfoInput } from "./discovery-scan.type";
import { ScanDirectoryInput, ScanDirectoryOutput } from "../scan-activity.type";
import { isPathExists } from "../../utils/utils";
import { LoggerService, LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { FileType } from "src/activities/types/tasks";
import { FileTypeDetectionService } from '../../utils/file-type-detection.service';
import { WinOperationService } from '../../migrate/command-execution/win-opeartions/win-operation.service';


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
        const shouldScanADS:boolean = jobContext.jobConfig?.options?.shouldScanADS;
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
                const fileType = await this.fileTypeDetectionService.detectFileType(sourceContentPath, sourceStat);
                this.logger.debug(`FileType for path ${sourceContentPath} is ${fileType}`);

                await this.publishFileInfo({
                    stats: sourceStat, command, jobContext, fPath: sourceContentPath, relativeSourcePath, fileType, shouldScanADS
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
    
    getItemInfo(stats: fs.Stats, fPath: string, relativeSourcePath: string, fileType:FileType , isDirectory: boolean, fileSize: number): ItemInfo{
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
            fileSize,
            stats.ino,
            false
        );
        return itemInfo;

    }
    
    async publishFileInfo({ jobContext, command, stats, fPath, relativeSourcePath, fileType, shouldScanADS }: PublishItemInfoInput): Promise<void> {
        const isDirectory = stats.isDirectory();
        const itemInfo = this.getItemInfo(stats, fPath, relativeSourcePath, fileType, isDirectory, stats.size);        
        try {
            await jobContext.publishToFileStream(itemInfo);
            if(process.platform === 'win32' && shouldScanADS){           
                const adsInfo = await this.winOperationService.detectADSInfo(jobContext, command, fPath);            
                if (!adsInfo.hasADS) {
                    return;
                }
                const items = [];
                // Publish each ADS stream as a separate inventory item
                for (let i = 0; i < adsInfo.streamNames.length; i++) {
                    const streamName = adsInfo.streamNames[i];
                    const streamSize = adsInfo.streamSizes[i];
                    const streamRelativePath = `${relativeSourcePath}:${streamName}`;                
                    items.push(this.getItemInfo(stats, fPath, streamRelativePath, FileType.STREAM, isDirectory, streamSize));                
                }
                await jobContext.publishToFileStreamBulk(items);
            }        
        }catch (error) {              
                this.logger.error(`Failed to publish file stream info ${relativeSourcePath}: ${error.message}`);                
                throw error;
            } 
    }
}
