import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Command, ErrorType, FileInfo, MetaData, OPS_CMD, OPS_STATUS } from "@netapp-cloud-datamigrate/jobs-lib";
import { uuid4 } from "@temporalio/workflow";
import * as fs from "fs";
import * as path from "path";
import { dmError, getFileInfo, isContentUpdate, removePrefix, shouldExcludeOrSkip } from "src/activities/utils/utils";
import { Operation, Origin } from "src/activities/utils/utils.types";
import { FatalError } from "src/errors/errors.types";
import { DirContentsInput, PublishCommandInput } from "./migrate-scan.type";
import { ScanDirectoryInput, ScanDirectoryOutput } from "../scan-activity.type";
import { JobManger } from "@local/job-lib";


@Injectable()
export class MigrateScanService {
    readonly workerId: string;
    readonly maxMigrationCommand : number;
    readonly maxConcurrency: number;
    readonly maxRetryCount: number;

    constructor(
        @Inject(ConfigService) 
        private readonly configService: ConfigService,
        private readonly logger: Logger,
        private readonly jobManager: JobManger
    ) {
        this.workerId = this.configService.get<string>('worker.workerId');
        this.maxMigrationCommand = this.configService.get('worker.maxMigrationCommand') || 100;
        this.maxConcurrency = this.configService.get('worker.maxCommandConcurrency') || 100; 
        this.maxRetryCount = this.configService.get('worker.maxRetryCount') || 3;  
    }


    async publishCommands({ jobRunId, commands}: PublishCommandInput)  {
        //TODO: make bulk publish to command stream. 
        for(const command of commands)
            await this.jobManager.publishToCommandStream(jobRunId, command);
    }

    async getDirContents({path, origin, jobRunId, errorType, command}: DirContentsInput): Promise<Set<string>>{
        let content = new Set<string>();
        try{
            if (!fs.existsSync(path)) {
                if (origin === Origin.SOURCE)  
                    throw new FatalError(`Source directory does not exist: ${path}`);
                return content; 
            }
            content = new Set<string>( await fs.promises.readdir(path)); 
        }catch(error){
            if(error instanceof FatalError) 
                errorType = ErrorType.FATAL_ERROR;
            const ndmError = dmError("OPERATION", origin, Operation.READ_DIR, errorType, command.commandId, error, {name: command.fPath, path: path});
            await this.jobManager.publishToErrorStream(jobRunId, ndmError);
            throw error; 
        }
        return content;
    }

    async scanDirectory({ jobRunId,  jobConfig, sourcePath, sourcePrefix, targetPath , command, settings}: ScanDirectoryInput): Promise<ScanDirectoryOutput> { 

        const output: ScanDirectoryOutput = { fileCount: 0, dirCount: 0, subDirs: []}
        let commands: Command[] = [], errorType: ErrorType = command.retryCount+1 > this.maxRetryCount ? ErrorType.TRANSIENT_ERROR : ErrorType.RECOVERABLE_ERROR;

        const sourceContent = await this.getDirContents({path: sourcePath, origin: Origin.SOURCE, jobRunId, errorType, command});
        const targetContent = await this.getDirContents({path: targetPath, origin: Origin.DESTINATION, jobRunId, errorType, command});

        for (const item of sourceContent) {
            try {
                const sourceContentPath = path.join(sourcePath, item);
                if (!fs.existsSync(sourceContentPath)) continue;

                const sourceStat = await fs.promises.lstat(sourceContentPath);
                const relativeSourcePath = removePrefix(sourceContentPath, sourcePrefix);
                
                if (shouldExcludeOrSkip({
                    fullPath: sourceContentPath,
                    stats: sourceStat,
                    excludePatterns: settings.excludePatterns,
                    skipTime: settings.skipFile,
                    olderThan: new Date(jobConfig.options?.excludeOlderThan),
                    jobType: jobConfig.jobType
                })) continue;

                const fileInfo: FileInfo = await getFileInfo({name: item, fullFilePath: sourceContentPath, relativePath: relativeSourcePath});

                if (sourceStat.isDirectory() && !sourceStat.isSymbolicLink()) {
                    output.dirCount++;
                    output.subDirs.push(relativeSourcePath);
                    this.logger.debug(`Scan Path ${relativeSourcePath} | parent ${sourcePath}`)
                    if(!targetContent.has(item)) {
                        const commandSync = this.buildCommand(sourceStat, fileInfo.path);
                        if (commandSync) commands.push(commandSync);
                    }
                } else if (!targetContent.has(item)) {
                    output.fileCount++;
                    const commandSync = this.buildCommand(sourceStat, fileInfo.path);
                    if (commandSync) commands.push(commandSync);
                } else {
                    const targetFilePath = path.join(targetPath, item);
                    if (fs.existsSync(targetFilePath)) {
                        const targetStat = fs.statSync(targetFilePath);
                        const commandSync = this.buildCommand(sourceStat, fileInfo.path, targetStat);
                        if (commandSync) commands.push(commandSync);
                    }
                }
                if(commands.length >= this.maxMigrationCommand) {
                    const chunk = commands.splice(0, this.maxMigrationCommand);
                    await this.publishCommands({ jobRunId, commands: chunk });
                }
                
            }catch(error) {
                this.logger.error(`Error processing item ${item} in directory ${sourcePath}: ${error}`);
                const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.READ_DIR, errorType, command.commandId, error, {name: command.fPath, path: targetPath});
                await this.jobManager.publishToErrorStream(jobRunId, dmErr);
                throw error; 
            }
        }
        if (commands.length > 0) {
            await this.publishCommands({ jobRunId, commands: commands });
            commands = [];
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
