import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Command, CommandStatus, FileInfo, JobContext, MetaData, OPS_CMD, OPS_STATUS, TaskStatus, TaskType } from "@netapp-cloud-datamigrate/jobs-lib";
import { uuid4 } from "@temporalio/workflow";
import * as fs from "fs";
import * as path from "path";
import { RedisService } from "src/redis/redis.service";

import { buildTask, dmError, getFileInfo, removePrefix, shouldExclude } from "../utils/utils";
import { ScanContentInput, ScanContentOutput, ScanPathInput, ScanPathOutput } from "./migrate.type";
import { error } from "console";

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
        if (!fs.existsSync(directoryPath)) 
            return [];
        return  await fs.promises.readdir(directoryPath);
    }

    async scanContent({ excludePatterns = [], jobContext, jobRunId, sourcePath, sourcePrefix, targetPath, command }: ScanContentInput): Promise<ScanContentOutput> {
        const syncContentOutput: ScanContentOutput = { files: 0, directory: 0, isGeneratedTask: false, error: undefined };
        let commands: Command[] = [], sourceContent: Set<string> =  new Set(), targetContent: Set<string> = new Set();

        try {
            sourceContent = new Set<string>(await this.getDirectoryContents(sourcePath));
        }catch(error) {
            const dmErr = dmError("OPERATION", command.commandId, error, {name: command.fPath, path: sourcePath});
            await jobContext.appendToErrorList(dmErr);
            syncContentOutput.error = error?.code || '';
            return syncContentOutput;
        }

        try {
            targetContent = new Set<string>(await this.getDirectoryContents(targetPath));           
        }
        catch(error) {
            const dmErr = dmError("OPERATION", command.commandId, error, {name: command.fPath, path: targetPath});
            await jobContext.appendToErrorList(dmErr);
            syncContentOutput.error = error?.code || '';
            return syncContentOutput;
        }

        for (const item of sourceContent) {
            try {
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
            }catch(error) {
                const dmErr = dmError("OPERATION", command.commandId, error, {name: command.fPath, path: sourcePath});
                await jobContext.appendToErrorList(dmErr);
                syncContentOutput.error = error?.code || '';
            }
        }
        if (commands.length > 0) {
            const task = buildTask(TaskType.MIGRATE, jobRunId, jobContext, commands);
            const id = await jobContext.appendToMigrationTask(task);
            jobContext.migrateTask.lastId = id;
        }
        commands = [];
        return syncContentOutput;
    }

    async scanPath({ task }: ScanPathInput): Promise<ScanPathOutput> {
        const scanPath: ScanPathOutput = { isTaskCreated: false, errors: new Set<string>(), success: 0, error: 0 };
        const jobContext: JobContext = await this.redisService.getJobContext(task.jobRunId);
        task.status = TaskStatus.RUNNING;
        task.commands.map((cmd: Command) => cmd.status = CommandStatus.IN_PROCESS);
        let id = await jobContext.appendToUpdatedTaskList(task);
        jobContext.updatedTaskInfo.lastId = id;
        await this.redisService.setJobContext(task.jobRunId, jobContext);

        let isError = false;
        for (let i = 0;  i < task.commands.length; i++) {
            const scanInput: ScanContentInput = {
                excludePatterns: task.excludeFilePatterns ? task.excludeFilePatterns.split(",") : [],
                sourcePath: `${task.sPath}${task.commands[i].fPath}`,
                sourcePrefix: task.sPath,
                targetPath: `${task.tPath}${task.commands[i].fPath}`,
                jobRunId: task.jobRunId,
                command: task.commands[i],
                jobContext
            };
            const result = await this.scanContent(scanInput);
            this.logger.log(`Result of scanContent: ${JSON.stringify(result)}`);
            if (result.isGeneratedTask) 
                scanPath.isTaskCreated = true;
            if (result.error) 
                task.commands[i].status = CommandStatus.ERROR, scanPath.errors.add(result.error), scanPath.error++;
            else  
                scanPath.success++, task.commands[i].status = CommandStatus.COMPLETED
        }      
        task.status = scanPath.error > 0 ? TaskStatus.ERRORED : TaskStatus.COMPLETED;
        if( scanPath.error > 0) {
            const dmErr = dmError("TASK", task.id,  undefined, undefined, {
                errorCode: scanPath.errors.size > 0 ? Array.from(scanPath.errors) : [], 
                message: `Task ${task.id} has ${scanPath.error} errors and ${scanPath.success} success during scan`
            });
            await jobContext.appendToErrorList(dmErr);
        }
        id = await jobContext.appendToUpdatedTaskList(task);
        jobContext.updatedTaskInfo.lastId = id;
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
                    0: { cmd: sFile.isDirectory() ? OPS_CMD.COPY_DIR:  OPS_CMD.COPY_CONTENT, status: OPS_STATUS.READY },
                    1: { cmd: OPS_CMD.STAMP_META, status: OPS_STATUS.READY, metadata}
                },
                uuid4()
            );
        }
        return undefined;
    }
}
