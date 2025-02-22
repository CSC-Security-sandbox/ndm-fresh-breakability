import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Command, FileInfo, Task } from "@netapp-cloud-datamigrate/jobs-lib";
import { uuid4 } from "@temporalio/workflow";
import * as fs from "fs";
import * as path from "path";
import { Logger } from "src/logger/logger.service";
import { RedisService } from "src/redis/redis.service";
import { buildTask, getChecksum, getFileInfo, removePrefix, shouldExclude } from "../utils/utils";
import { OPS_CMD, ScanContentInput, ScanContentOutput, ScanPathInput, ScanPathOutput } from "./migrate.type";
import { OperationStatus } from "../discovery/enums";

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
        if (!fs.existsSync(directoryPath)) return
        try {
            const items = fs.readdirSync(directoryPath, { withFileTypes: true });
            for (const item of items) 
                yield item.name;
        } catch (error) {
            this.logger.error(`Error reading directory '${directoryPath}': ${error.message}`);
        }
    }

    async scanContent({ excludePatterns = [], jobContext, jobRunId, sourcePath, sourcePrefix, targetPath }: ScanContentInput): Promise<ScanContentOutput> {
        const syncContentOutput: ScanContentOutput = { files: 0, directory: 0, isGeneratedTask: false };
        let commands : Command[] = []
        try {
            const sourceContent = new Set<string>(this.getDirectoryContents(sourcePath));
            const targetContent = new Set<string>(this.getDirectoryContents(targetPath));

           
            for (const item of sourceContent) {
                const sourceContentPath = path.join(sourcePath, item);
                if (!fs.existsSync(sourceContentPath)) continue;

                const sourceStat = fs.statSync(sourceContentPath);
                const relativeSourcePath = removePrefix(sourceContentPath, sourcePrefix);

                if (sourceStat.isSymbolicLink() || shouldExclude(sourceContentPath, excludePatterns)) 
                    continue;

                const fileInfo: FileInfo = await getFileInfo(item, sourceContentPath, relativeSourcePath);

                if (sourceStat.isDirectory()) {
                    syncContentOutput.directory++;
                    const id = await jobContext.appendToDirList(fileInfo);
                    jobContext.dirsInfo.lastId = id;
                    jobContext.dirsInfo.numMessages++;
                    syncContentOutput.isGeneratedTask = true;
                } else if (!targetContent.has(item)) {
                    syncContentOutput.files++;
                    const command = this.buildCommand(sourceStat, fileInfo.path);
                    if(command)  commands.push(command)
                } else {
                    const targetFilePath = path.join(targetPath, item);
                    if (fs.existsSync(targetFilePath)) {
                        const targetStat = fs.statSync(targetFilePath);
                        const command = this.buildCommand(sourceStat, fileInfo.path, targetStat);
                        if(command)  commands.push(command)
                    }
                }
            }
        } catch (error) {
            jobContext.errorsInfo?.init();
            this.logger.error(`Error in scanContent: ${error.message}`);
        } finally {
            if(commands.length > 0) {
                const task = buildTask('MIGRATE', jobRunId, jobContext, commands);
                const id = await jobContext.appendToMigrationTask(task);
                jobContext.tasksInfo.lastId = id;
            } 
            commands = []
            await this.redisService.setJobContext(jobRunId, jobContext);
        }
        return syncContentOutput;
    }

    async scanPath({ task }: ScanPathInput): Promise<ScanPathOutput> {
        const scanPath: ScanPathOutput = { isTaskCreated: false };
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

    buildCommand = (sFile: fs.Stats, fPath: string, dFile?: fs.Stats | undefined, ): Command | undefined=> {
        if(!dFile || sFile.size !== dFile.size || sFile.mtime != dFile.mtime)
            return new Command(fPath, { 
                    0: { cmd: OPS_CMD.COPY_CONTENT, status: OperationStatus.READY},
                    1: { cmd: OPS_CMD.STAMP_META, status: OperationStatus.READY}
                },
            `cmd-${uuid4()}`)
        return undefined;
    }  
}
