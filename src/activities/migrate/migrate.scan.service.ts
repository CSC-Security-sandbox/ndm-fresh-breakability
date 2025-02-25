import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Command, FileInfo, JobContext, MetaData } from "@netapp-cloud-datamigrate/jobs-lib";
import { uuid4 } from "@temporalio/workflow";
import * as fs from "fs";
import * as path from "path";
import { RedisService } from "src/redis/redis.service";
import { OperationStatus, TaskStatus } from "../discovery/enums";
import { buildTask, getFileInfo, removePrefix, shouldExclude } from "../utils/utils";
import { OPS_CMD, ScanContentInput, ScanContentOutput, ScanPathInput, ScanPathOutput } from "./migrate.type";

@Injectable()
export class MigrationScanService {
    readonly workerId: string;
    readonly workerJobServiceUrl: string;

    constructor(
        @Inject(ConfigService) private readonly configService: ConfigService,
        private readonly logger: Logger,
        private readonly redisService: RedisService,
    ) {
        this.workerId = this.configService.get<string>('worker.workerId');
    }

    async getDirectoryContents(directoryPath: string): Promise<string[]> {
        if (!fs.existsSync(directoryPath)) {
            return [];
        }
        try {
            return  await fs.promises.readdir(directoryPath);
        } catch (error) {
            this.logger.error(`Error reading directory '${directoryPath}': ${error.message}`);
            return [];
        }
    }

    async scanContent({ excludePatterns = [], jobContext, jobRunId, sourcePath, sourcePrefix, targetPath }: ScanContentInput): Promise<ScanContentOutput> {
        const syncContentOutput: ScanContentOutput = { files: 0, directory: 0, isGeneratedTask: false };
        let commands: Command[] = [];
        try {
            const sourceContent = new Set<string>(await this.getDirectoryContents(sourcePath));
            const targetContent = new Set<string>(await this.getDirectoryContents(targetPath));

 
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
                    if(!targetContent.has(item)) {
                        const command = this.buildCommand(sourceStat, fileInfo.path);
                        if (command) commands.push(command);
                    }
                } else if (!targetContent.has(item)) {
                    syncContentOutput.files++;
                    const command = this.buildCommand(sourceStat, fileInfo.path);
                    if (command) commands.push(command);
                } else {
                    const targetFilePath = path.join(targetPath, item);
                    if (fs.existsSync(targetFilePath)) {
                        const targetStat = fs.statSync(targetFilePath);
                        const command = this.buildCommand(sourceStat, fileInfo.path, targetStat);
                        if (command) commands.push(command);
                    }
                }
            }
        } catch (error) {
            jobContext.errorsInfo?.init();
            this.logger.error(`Error in scanContent: ${error.message}`);
        } finally {
            if (commands.length > 0) {
                const task = buildTask('MIGRATE', jobRunId, jobContext, commands);
                const id = await jobContext.appendToMigrationTask(task);
                jobContext.migrateTask.lastId = id;
            }
            commands = [];
            await this.redisService.setJobContext(jobRunId, jobContext);
        }
        return syncContentOutput;
    }

    async scanPath({ task }: ScanPathInput): Promise<ScanPathOutput> {
        const scanPath: ScanPathOutput = { isTaskCreated: false };
        const jobContext: JobContext = await this.redisService.getJobContext(task.jobRunId);
        task.status = TaskStatus.Running;
        task.commands.map((cmd: any) => cmd.status = OperationStatus.IN_PROCESS);
        let id = await jobContext.appendToUpdatedTaskList(task);
        jobContext.updatedTaskInfo.lastId = id;
        await this.redisService.setJobContext(task.jobRunId, jobContext);

        for (const cmd of task.commands) {
            const scanInput: ScanContentInput = {
                excludePatterns: task.excludeFilePatterns ? task.excludeFilePatterns.split(",") : [],
                sourcePath: `${task.sPath}${cmd.fPath}`,
                sourcePrefix: task.sPath,
                targetPath: `${task.tPath}${cmd.fPath}`,
                jobRunId: task.jobRunId,
                jobContext
            };

            const result = await this.scanContent(scanInput);
            this.logger.log(`Result of scanContent: ${JSON.stringify(result)}`);
            if (result.isGeneratedTask) {
                scanPath.isTaskCreated = true;
            }
        }

        task.status = TaskStatus.Completed;
        task.commands.map((cmd: any) => cmd.status = OperationStatus.COMPLETED);
        jobContext.updatedTaskInfo.lastId = id;
        id = await jobContext.appendToUpdatedTaskList(task);
        await this.redisService.setJobContext(task.jobRunId, jobContext);
        return scanPath;
    }

    buildCommand = (sFile: fs.Stats, fPath: string, dFile?: fs.Stats): Command | undefined => {
        if (!dFile || (sFile.size !== dFile.size) || (sFile.mtime.toISOString() !== dFile.mtime.toISOString())) {
            const metadata: MetaData =  { 
                size: sFile.size,
                mtime: sFile.mtime,
                mode: sFile.mode,
                uid: sFile.uid,
                gid: sFile.gid,
                atime: sFile.atime,
                ctime: sFile.ctime,
                birthtime: sFile.birthtime,
            } 
            return new Command(
                fPath,
                {
                    0: { cmd: sFile.isDirectory() ? OPS_CMD.COPY_DIR:  OPS_CMD.COPY_CONTENT, status: OperationStatus.READY },
                    1: { cmd: OPS_CMD.STAMP_META, status: OperationStatus.READY, metadata}
                },
                uuid4()
            );
        }
        return undefined;
    }
}
