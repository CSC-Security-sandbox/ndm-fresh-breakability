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
import { isPathExists } from "../../utils/utils";


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
            const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.READ_DIR, errorType, command.id, error, {name: command.fPath, path: sourcePath});
            await jobContext.publishToErrorStream(dmErr);
            throw error; 
        }
        return output;
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
                stats.size,
                stats.ino
            )
            await jobContext.publishToFileStream(itemInfo);
        }

}
