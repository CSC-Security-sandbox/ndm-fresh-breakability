import { Catch, Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cmd, ErrorType, FileInfo, JobManagerContext, ItemInfo, ItemMeta } from "@netapp-cloud-datamigrate/jobs-lib";
import * as fs from 'fs';
import * as path from 'path';
import { dmError, getFilePermissions, removePrefix, shouldExcludeOrSkip, checkCaseSensitiveConflict } from "src/activities/utils/utils";
import { Operation, Origin } from "src/activities/utils/utils.types";
import { FatalError } from "src/errors/errors.types";
import { PublishItemInfoInput } from "./discovery-scan.type";
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
    readonly parallelLstatConcurrency: number;
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
        this.parallelLstatConcurrency = this.configService.get<number>('worker.parallelLstatConcurrency') || 50;
        this.logger = loggerFactory.create(DiscoveryScanService.name);
    }


    async scanDirectory({ jobContext, sourcePath, sourcePrefix, command, settings, errorType}: ScanDirectoryInput): Promise<ScanDirectoryOutput> {
        const output: ScanDirectoryOutput = { fileCount: 0, dirCount: 0, subDirs: []}
        const isSMB = process.platform === 'win32';
        const lowerCaseSourceDirs = new Set<string>();
        const shouldScanADS:boolean = jobContext.jobConfig?.options?.shouldScanADS;
        try {
            const pathExists = await isPathExists(sourcePath);
            if (!pathExists) {
                throw new FatalError(`Source directory does not exist: ${sourcePath}`);
            }

            // Phase 1: Collect all entry names from the directory.
            // opendir + iterate is cheap — getdents is kernel-buffered and returns
            // names in a single syscall batch. We collect into an array so that
            // Phase 2 can issue lstat calls in parallel rather than one-by-one.
            const entryNames: string[] = [];
            const dir = await fs.promises.opendir(sourcePath);
            try {
                for await (const item of dir) {
                    entryNames.push(item.name);
                }
            } catch (error) {
                this.logger.error(`Error reading directory entries ${sourcePath}: ${error.message}`);
                throw error;
            }

            // Phase 2: Parallel lstat in controlled chunks.
            // Instead of awaiting one lstat per loop iteration (sequential, ~5ms each on NFS),
            // we fire up to `parallelLstatConcurrency` lstats concurrently via Promise.all.
            // For 1,000 entries on NFS at 5ms/lstat:
            //   Before: 1,000 × 5ms = 5,000ms (serial)
            //   After:  1,000 / 50 × 5ms = 100ms (50 concurrent)
            try {
                for (let i = 0; i < entryNames.length; i += this.parallelLstatConcurrency) {
                    const chunk = entryNames.slice(i, i + this.parallelLstatConcurrency);

                    const statResults = await Promise.all(
                        chunk.map(async (name) => {
                            const fullPath = path.join(sourcePath, name);
                            const stat = await fs.promises.lstat(fullPath);
                            return { name, fullPath, stat };
                        })
                    );

                    // Phase 3: Process stat results sequentially.
                    // Filtering, classification, publishing, and subdirectory collection
                    // are fast in-memory operations — no need to parallelize these.
                    for (const { name, fullPath: sourceContentPath, stat: sourceStat } of statResults) {
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
                                    name,
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
                }
            } catch (error){
                this.logger.error(`Error scanning directory ${sourcePath}: ${error.message}`);
                throw error;
            }
        }catch(error) {
            if(error instanceof FatalError)
                errorType = ErrorType.FATAL_ERROR;
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
            false,
            null // checksumTime is null for discovery scan (no checksum generated)
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
