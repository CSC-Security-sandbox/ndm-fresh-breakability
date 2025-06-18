import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@temporalio/worker";
import { CommonActivityService } from "src/activities/common/common.service";
import { RedisService } from "src/redis/redis.service";
import { uuid4 } from "@temporalio/workflow";
import * as fs from "fs";
import * as path from "path";
import { ScanActivityInput, ScanActivityOutput, ScanDirectoryInput, ScanDirectoryOutput } from "./migrate-scan.type";
import { Command, ErrorType, FileInfo, JobContext, MetaData, OPS_CMD, OPS_STATUS, TaskType } from "@netapp-cloud-datamigrate/jobs-lib";
import { basePrefix, buildTask, dmError, getFileInfo, isContentUpdate, removePrefix, shouldExcludeOrSkip } from "src/activities/utils/utils";
import { Operation, Origin } from "src/activities/utils/utils.types";
import { PublishMigrationTaskInput } from "../migrate.type";

@Injectable()
export class MigrateScanService {
    readonly workerId: string;
    readonly maxMigrationCommand : number;
    readonly maxConcurrency: number;
    constructor(
        @Inject(ConfigService) private readonly configService: ConfigService,
        private readonly logger: Logger,
        private readonly redisService: RedisService,
    ) {
        this.workerId = this.configService.get<string>('worker.workerId');
        this.maxMigrationCommand = this.configService.get('worker.maxMigrationCommand') || 100;
        this.maxConcurrency = this.configService.get('worker.maxCommandConcurrency') || 100;   
    }


    async getDirectoryContents(directoryPath: string): Promise<string[]> {
        if (!fs.existsSync(directoryPath)) 
            return [];
        return  await fs.promises.readdir(directoryPath);
    
    }
    async publishMigrationTask({ jobContext, commands}: PublishMigrationTaskInput)  {
        const task = buildTask(TaskType.MIGRATE, jobContext.jobRunId, jobContext, commands);
        jobContext.migrateTask.lastId  = await jobContext.appendToMigrationTask(task);
        this.logger.debug(`[${jobContext.jobRunId}] Task published: ${task?.id} | stats : ${task?.status} | command : ${task?.commands?.length}`);
    }

    async scanDirectory({excludePatterns = [], jobContext, sourcePath, sourcePrefix, targetPath, jobRunId, skipFile, }: ScanDirectoryInput): Promise<ScanDirectoryOutput> {
        
        const output: ScanDirectoryOutput = {jobRunId, fileCount: 0, dirCount: 0, command: [], subDirs: []};
        let sourceContent: Set<string> =  new Set(), targetContent: Set<string> = new Set();
      
        try {
            sourceContent = new Set<string>(await this.getDirectoryContents(sourcePath));
        }catch(error) {
            this.logger.error(`Error reading source directory ${sourcePath}: ${error}`);
        }

        try {
            targetContent = new Set<string>(await this.getDirectoryContents(targetPath));           
        }
        catch(error) {
           this.logger.error(`Error reading target directory ${targetPath}: ${error}`);

        }
        
        for (const item of sourceContent) {
            try {
                const sourceContentPath = path.join(sourcePath, item);
                if (!fs.existsSync(sourceContentPath)) continue;

                const sourceStat = await fs.promises.lstat(sourceContentPath);
                const relativeSourcePath = removePrefix(sourceContentPath, sourcePrefix);
                
                if (shouldExcludeOrSkip({
                    fullPath: sourceContentPath,
                    stats: sourceStat,
                    excludePatterns,
                    skipTime: skipFile,
                    olderThan: new Date(jobContext.jobConfig.options?.excludeOlderThan),
                    jobType: jobContext.jobConfig.jobType
                })) continue;

                const fileInfo: FileInfo = await getFileInfo({name: item, fullFilePath: sourceContentPath, relativePath: relativeSourcePath});

                if (sourceStat.isDirectory() && !sourceStat.isSymbolicLink()) {
                    output.dirCount++;
                    output.subDirs.push(relativeSourcePath);
                    if(!targetContent.has(item)) {
                        const command = this.buildCommand(sourceStat, fileInfo.path);
                        if (command) output.command.push(command);
                    }
                } else if (!targetContent.has(item)) {
                    output.fileCount++;
                    const command = this.buildCommand(sourceStat, fileInfo.path);
                    if (command) output.command.push(command);
                } else {
                    const targetFilePath = path.join(targetPath, item);
                    if (fs.existsSync(targetFilePath)) {
                        const targetStat = fs.statSync(targetFilePath);
                        const command = this.buildCommand(sourceStat, fileInfo.path, targetStat);
                        if (command) output.command.push(command);
                    }
                }
                if(output.command.length >= this.maxMigrationCommand) {
                    const chunk = output.command.splice(0, this.maxMigrationCommand);
                    await this.publishMigrationTask({ jobContext, commands: chunk });
                }
            }catch(error) {
                this.logger.error(`Error processing item ${item} in directory ${sourcePath}: ${error}`);
            }
        }
        return output
    }

    async scanDirectories ({jobRunId, dirsToScan}: ScanActivityInput): Promise<ScanActivityOutput>  {
        const output: ScanActivityOutput = {
            dirCount: 0,
            fileCount: 0,
            subDirs: [],
            jobRunId: jobRunId
        }
        const jobContext: JobContext = await this.redisService.getJobContext(jobRunId);
        const jobConfig = jobContext.getJobConfig();

        const baseSourcePrefixPath = basePrefix(jobRunId, jobConfig.sourceFileServer.pathId);
        const baseTargetPrefixPath = basePrefix(jobRunId, jobConfig.destinationFileServer.pathId);
        const excludePatterns = jobContext.jobConfig.options?.excludeFilePattern ? jobContext.jobConfig.options.excludeFilePattern.split(",") : [];
        const skipFile = jobContext.jobConfig.options?.skipsFilesModifiedInLast ?? '';
        
        const commands :Command[] = []
        for (let i = 0; i < dirsToScan.length; i += this.maxConcurrency) {
            const batch = dirsToScan.slice(i, i + this.maxConcurrency);
            await Promise.allSettled(
                batch.map(async (dirPath) => {
                    const scanDirectoryInput : ScanDirectoryInput = {
                        excludePatterns,
                        sourcePath: `${baseSourcePrefixPath}${dirPath}`,
                        sourcePrefix: baseSourcePrefixPath,
                        targetPath: `${baseTargetPrefixPath}${dirPath}`,
                        jobRunId,
                        jobContext,
                        skipFile,
                    }
                    const result = await this.scanDirectory(scanDirectoryInput);
                    output.fileCount += result.fileCount;
                    output.dirCount += result.dirCount;
                    output.subDirs.push(...result.subDirs);
                    commands.push(...result.command);


                    if (commands.length >= this.maxMigrationCommand) {
                        const chunk = commands.splice(0, this.maxMigrationCommand);
                        await this.publishMigrationTask({ jobContext, commands: chunk });
                    }
                })
            )
        }

        if (commands.length > 0) {
            await this.publishMigrationTask({ jobContext, commands });
        }

        return output
    }

        buildCommand = (sFile: fs.Stats, fPath: string, dFile?: fs.Stats): Command | undefined => {
            const metadata: MetaData =  { 
                size: sFile.size,
                mtime: sFile.mtime,
                mode: sFile.mode,
                uid: sFile.uid,
                gid: sFile.gid,
                atime: sFile.atime,
                ctime: sFile.ctime,
                birthtime: sFile.birthtime,
                sid: undefined
            } 
            if (isContentUpdate(sFile, dFile) ) 
                return new Command(
                    fPath,
                    {
                        0: { cmd: sFile.isDirectory() ? OPS_CMD.COPY_DIR:  OPS_CMD.COPY_CONTENT, status: OPS_STATUS.READY },
                        1: { cmd: OPS_CMD.STAMP_META, status: OPS_STATUS.READY, metadata}
                    },
                    uuid4(),
                    0
                );
    
            return undefined;
        }
}