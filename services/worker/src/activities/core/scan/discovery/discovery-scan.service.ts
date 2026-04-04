import { Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cmd, ErrorType, JobManagerContext, ItemInfo, ItemMeta } from "@netapp-cloud-datamigrate/jobs-lib";
import * as fs from 'fs';
import * as path from 'path';
import { dmError, getFilePermissions, removePrefix, shouldExcludeOrSkip, checkCaseSensitiveConflict } from "src/activities/utils/utils";
import { Operation, Origin } from "src/activities/utils/utils.types";
import { FatalError } from "src/errors/errors.types";
import { PublishItemInfoInput } from "./discovery-scan.type";
import { ScanDirectoryInput, ScanDirectoryOutput, ScanDirectorySettings } from "../scan-activity.type";
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
        // Default 2× UV_THREAD_POOL_SIZE (typically 16) to keep libuv threads
        // saturated with zero idle gaps between chunks. lstat is a lightweight
        // metadata-only call, so a small queue (~16 items, ~8KB) is cheap.
        this.parallelLstatConcurrency = this.configService.get<number>('worker.parallelLstatConcurrency') || 32;
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

            // Streaming chunked scan: read entry names from opendir in chunks of
            // parallelLstatConcurrency, issue parallel lstat per chunk, process
            // results, and bulk-publish to Redis — all within the same iteration.
            //
            // Memory stays bounded to ~parallelLstatConcurrency entries at every
            // stage (names, stats, ItemInfo objects). This preserves opendir's
            // streaming advantage — we never load the full directory into memory.
            //
            // For 1,000 entries on NFS at 5ms/lstat with concurrency 50:
            //   Before (serial):  1,000 × 5ms = 5,000ms
            //   After (parallel): 1,000 / 50 × 5ms = 100ms
            const dir = await fs.promises.opendir(sourcePath, { bufferSize: this.parallelLstatConcurrency });
            try {
                let chunk: string[] = [];

                for await (const item of dir) {
                    chunk.push(item.name);

                    if (chunk.length >= this.parallelLstatConcurrency) {
                        await this.processChunk(chunk, sourcePath, sourcePrefix, jobContext, command, settings, isSMB, shouldScanADS, lowerCaseSourceDirs, output);
                        chunk = [];
                    }
                }

                // Process remaining entries that didn't fill a complete chunk
                if (chunk.length > 0) {
                    await this.processChunk(chunk, sourcePath, sourcePrefix, jobContext, command, settings, isSMB, shouldScanADS, lowerCaseSourceDirs, output);
                }
            } catch (error) {
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

    /**
     * Processes a chunk of directory entry names: parallel lstat, filter,
     * classify, and bulk-publish to Redis. Called once per chunk from scanDirectory.
     * Memory is bounded to chunk.length entries at each stage.
     */
    private async processChunk(
        chunk: string[],
        sourcePath: string,
        sourcePrefix: string,
        jobContext: JobManagerContext,
        command: Cmd,
        settings: ScanDirectorySettings,
        isSMB: boolean,
        shouldScanADS: boolean,
        lowerCaseSourceDirs: Set<string>,
        output: ScanDirectoryOutput,
    ): Promise<void> {
        const chunkItems: ItemInfo[] = [];

        // Parallel lstat for this chunk
        const statResults = await Promise.all(
            chunk.map(async (name) => {
                const fullPath = path.join(sourcePath, name);
                const stat = await fs.promises.lstat(fullPath);
                return { name, fullPath, stat };
            })
        );

        // Process stat results: filter, classify, collect ItemInfo
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

            const isDirectory = sourceStat.isDirectory();
            const itemInfo = this.getItemInfo(sourceStat, sourceContentPath, relativeSourcePath, fileType, isDirectory, sourceStat.size);
            chunkItems.push(itemInfo);

            // Collect ADS items into the same chunk array (Windows only)
            if (isSMB && shouldScanADS) {
                const adsItems = await this.collectADSItems(jobContext, command, sourceContentPath, relativeSourcePath, sourceStat, isDirectory);
                chunkItems.push(...adsItems);
            }

            if (isDirectory) {
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

        // Bulk publish this chunk's items to Redis immediately.
        // chunkItems goes out of scope after this, freeing memory for the next chunk.
        if (chunkItems.length > 0) {
            await jobContext.publishToFileStreamBulk(chunkItems);
        }
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
    
    /**
     * Collects ADS (Alternate Data Streams) items for a file on Windows.
     * Returns an array of ItemInfo objects for each ADS stream found.
     * Returns empty array if no ADS or not on Windows.
     */
    async collectADSItems(jobContext: JobManagerContext, command: Cmd, fPath: string, relativeSourcePath: string, stats: fs.Stats, isDirectory: boolean): Promise<ItemInfo[]> {
        try {
            const adsInfo = await this.winOperationService.detectADSInfo(jobContext, command, fPath);
            if (!adsInfo.hasADS) {
                return [];
            }
            const items: ItemInfo[] = [];
            for (let i = 0; i < adsInfo.streamNames.length; i++) {
                const streamName = adsInfo.streamNames[i];
                const streamSize = adsInfo.streamSizes[i];
                const streamRelativePath = `${relativeSourcePath}:${streamName}`;
                items.push(this.getItemInfo(stats, fPath, streamRelativePath, FileType.STREAM, isDirectory, streamSize));
            }
            return items;
        } catch (error) {
            this.logger.error(`Failed to collect ADS info for ${relativeSourcePath}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Publishes file info to Redis stream one entry at a time.
     * @deprecated Use bulk publish via collectADSItems + publishToFileStreamBulk instead.
     * Retained for backward compatibility with migrate scan path.
     */
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
