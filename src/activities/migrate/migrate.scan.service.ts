import { Inject, Injectable } from "@nestjs/common";
import { DMError, FileInfo } from "@netapp-cloud-datamigrate/jobs-lib";
import * as fs from "fs";
import * as path from "path";
import { getChecksum, getFileInfo, removePrefix, shouldExclude } from "../utils/utils";
import { ScanContentInput, ScanContentOutput, ScanPathInput, ScanPathOutput } from "./migrate.type";
import { ConfigService } from "@nestjs/config";
import { RedisService } from "src/redis/redis.service";
import { Logger } from "src/logger/logger.service";

@Injectable()
export class MigrationScanService {
    readonly workerId: string;

    constructor(
        @Inject(ConfigService) private readonly configService: ConfigService,
        private readonly logger: Logger,
        private readonly redisService: RedisService,
    ) {
        this.workerId = this.configService.get<string>('worker.workerId');
    }

    private *getDirectoryContents(directoryPath: string): Generator<string> {
        if (!fs.existsSync(directoryPath)) {
            // this.logger.warn(`Directory does not exist: ${directoryPath}`);
            return;
        }
        try {
            const items = fs.readdirSync(directoryPath, { withFileTypes: true });
            // this.logger.log(`Scanning directory: ${directoryPath}, found ${items.length} items.`);

            for (const item of items) {
                yield item.name;
            }
        } catch (error) {
            this.logger.error(`Error reading directory '${directoryPath}': ${error.message}`);
        }
    }

    async scanContent({ excludePatterns = [], jobContext, jobRunId, sourcePath, sourcePrefix, targetPath }: ScanContentInput): Promise<ScanContentOutput> {
        const syncContentOutput: ScanContentOutput = { files: 0, directory: 0, isGeneratedTask: false };

        try {
            const sourceContent = new Set<string>(this.getDirectoryContents(sourcePath));
            const targetContent = new Set<string>(this.getDirectoryContents(targetPath));

            // this.logger.log(`Scanning: sourcePath=${sourcePath}, targetPath=${targetPath}`);

            for (const item of sourceContent) {
                const sourceContentPath = path.join(sourcePath, item);
                if (!fs.existsSync(sourceContentPath)) continue;

                const sourceStat = fs.statSync(sourceContentPath);
                const relativeSourcePath = removePrefix(sourceContentPath, sourcePrefix);

                if (sourceStat.isSymbolicLink() || shouldExclude(sourceContentPath, excludePatterns)) {
                    continue;
                }

                const fileInfo: FileInfo = await getFileInfo(item, sourceContentPath, relativeSourcePath);
                // this.logger.log(`Processing: ${JSON.stringify(fileInfo)}`);

                if (sourceStat.isDirectory()) {
                    syncContentOutput.directory++;
                    await jobContext.appendToDirList(fileInfo);
                    syncContentOutput.isGeneratedTask = true;
                } else if (!targetContent.has(item)) {
                    syncContentOutput.files++;
                    await jobContext.appendToFileList(fileInfo);
                } else {
                    const targetFilePath = path.join(targetPath, item);
                    if (fs.existsSync(targetFilePath)) {
                        const targetStat = fs.statSync(targetFilePath);
                        if (targetStat.isFile()) {
                            try {
                                const [checksum1, checksum2] = await Promise.all([
                                    getChecksum(sourceContentPath),
                                    getChecksum(targetFilePath)
                                ]);
                                if (checksum1 !== checksum2) {
                                    syncContentOutput.files++;
                                    await jobContext.appendToFileList(fileInfo);
                                }
                            } catch (error) {
                                this.logger.error(`Error computing checksum for ${item}: ${error.message}`);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            jobContext.errorsInfo?.init();
            this.logger.error(`Error in scanContent: ${error.message}`);
        } finally {
            this.redisService?.setJobContext(jobRunId, jobContext);
        }
        return syncContentOutput;
    }

    async scanPath({ task }: ScanPathInput): Promise<ScanPathOutput> {
        const scanPath: ScanPathOutput = { isTaskCreated: false };
        // this.logger.log(`Executing scanPath: ${JSON.stringify(task.commands)}`);

        for (const cmd of task.commands) {
            const jobContext = await this.redisService.getJobContext(task.jobRunId);
            const scanInput: ScanContentInput = {
                excludePatterns: task.excludeFilePatterns ? task.excludeFilePatterns.split(",") : [],
                sourcePath: `${task.sPath}${cmd.fPath}`,
                sourcePrefix: task.sPath,
                targetPath: `${task.tPath}${cmd.fPath}`,
                jobRunId: task.jobRunId,
                jobContext
            };

            const result = await this.scanContent(scanInput);
            if (result.isGeneratedTask) {
                scanPath.isTaskCreated = true;
            }
        }

        return scanPath;
    }
}
