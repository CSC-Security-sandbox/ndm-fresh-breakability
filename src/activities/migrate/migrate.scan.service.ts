import { Inject, Injectable, Logger } from "@nestjs/common";
import { DMError, FileInfo } from "@netapp-cloud-datamigrate/jobs-lib";
import * as fs from "fs";
import * as path from "path";
import { getChecksum, getFileInfo, removePrefix, shouldExclude } from "../utils/utils";
import { ScanContentInput, ScanContentOutput, ScanPathInput, ScanPathOutput } from "./migrate.type";
import { ConfigService } from "@nestjs/config";
import { RedisService } from "src/redis/redis.service";

@Injectable()
export class MigrationScanService {


    readonly workerId: string;
    constructor(
        @Inject(ConfigService) private readonly configService: ConfigService,
        private readonly logger: Logger,
        private readonly redisService: RedisService,
    ) {
        this.workerId = this.configService.get('worker.workerId');
    }

    private *getDirectoryContents(directoryPath: string): Generator<string> {
        if (!fs.existsSync(directoryPath)) return;
        try {
            const items = fs.readdirSync(directoryPath, { withFileTypes: true });
            for (const item of items) {
                yield item.name;
            }
        } catch (error) {
            this.logger.error("Error reading directory:", error);
        }
    }

    async scanContent(scanInput: ScanContentInput): Promise<ScanContentOutput> {
        const syncContentOutput: ScanContentOutput = { files: [], directory: [], isGeneratedTask: false };
        try {
            const sourceContent = new Set<string>(await this.getDirectoryContents(scanInput.sourcePath));
            const targetContent = new Set<string>(await this.getDirectoryContents(scanInput.targetPath));

            for (const item of sourceContent) {
                const sourceContentPath = path.join(scanInput.sourcePath, item);
                if (!fs.existsSync(sourceContentPath)) continue;
                const sourceStat = fs.statSync(sourceContentPath);
                const relativeSourcePath = removePrefix(sourceContentPath, scanInput.sourcePrefix);

                if (sourceStat.isSymbolicLink() || shouldExclude(sourceContentPath, scanInput.excludePatterns))
                    continue;

                const fileInfo: FileInfo = await getFileInfo(item, sourceContentPath, relativeSourcePath);

                if (sourceStat.isDirectory()) {
                    syncContentOutput.directory.push(relativeSourcePath);
                    scanInput.jobContext.dirsInfo?.init();
                    scanInput.jobContext.appendToDirList(fileInfo);
                } else if (!targetContent.has(item)) {
                    syncContentOutput.files.push(relativeSourcePath);
                    scanInput.jobContext.filesInfo?.init();
                    scanInput.jobContext.appendToFileList(fileInfo);
                } else {
                    const targetFilePath = path.join(scanInput.targetPath, item);
                    if (fs.existsSync(targetFilePath)) {
                        const targetStat = fs.statSync(targetFilePath);
                        if (targetStat.isFile()) {
                            try {
                                const [checksum1, checksum2] = await Promise.all([
                                    getChecksum(sourceContentPath),
                                    getChecksum(targetFilePath)
                                ]);
                                if (checksum1 !== checksum2) {
                                    syncContentOutput.files.push(relativeSourcePath);
                                    scanInput.jobContext.filesInfo?.init();
                                    scanInput.jobContext.appendToFileList(fileInfo);
                                }
                            } catch (error) {
                                this.logger.error("Error computing checksum:", error);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            scanInput.jobContext.errorsInfo?.init();
            const dmError = new DMError(scanInput.sourcePath, error);
            await scanInput.jobContext.appendToErrorList(dmError);
        } finally {
            scanInput.clientConnection?.set(scanInput.jobRunId, scanInput.jobContext);
        }
        return syncContentOutput;
    }

    async scanPath({ task, jobContext, logger, clientConnection }: ScanPathInput): Promise<ScanPathOutput> {
        const scanPath: ScanPathOutput = { isTaskCreated: false };
        for (const cmd of task.commands) {
            const scanInput: ScanContentInput = {
                excludePatterns: task.excludeFilePatterns.split(","),
                jobContext,
                logger,
                sourcePath: `${task.sPath}/${cmd.fPath}`,
                sourcePrefix: task.sPath,
                targetPath: `${task.tPath}/${cmd.fPath}`,
                clientConnection,
                jobRunId: task.jobRunId
            };
            const result = await this.scanContent(scanInput);
            if (result.isGeneratedTask) scanPath.isTaskCreated = true;
        }
        return scanPath;
    }
}
