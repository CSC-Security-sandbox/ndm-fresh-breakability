import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Command, CommandStatus, ErrorType, FileInfo, JobContext, MetaData, OPS_STATUS, TaskStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { CommandConfig, CommandPattern } from 'src/config/command.config';
import { RedisService } from 'src/redis/redis.service';
import { WorkerThreadService } from 'src/thread/worker.thread.service';
import { CommonActivityService } from '../common/common.service';
import { ShellService } from '../common/shell.service';
import { basePrefix, dmError, formatDate, getFilePermissions, getFileType, getUserACLs, isFatalError, isSourceFatalError } from '../utils/utils';
import { ACL, getFileInfoInput, Operation, Origin } from '../utils/utils.types';
import { OPS_CMD, StampMetaDataOutput, SyncOperationInput, SyncOperationOutput, SyncTaskInput, SyncTaskOutput } from './migrate.type';
import { Context } from '@temporalio/activity';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { isPathExists } from '../core/utils/utils';


@Injectable()
export class MigrationSyncService {
  readonly workerId: string;
  readonly CHUNK_SIZE: number;
  readonly maxRetryCount: number;
  readonly maxConcurrency: number;
  private readonly logger: LoggerService;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly redisService: RedisService,
    private readonly commonService: CommonActivityService,
    private readonly shellService: ShellService,
    private readonly workerThreadService: WorkerThreadService,
  ) {
    this.workerId = this.configService.get('worker.workerId');
    this.maxRetryCount = this.configService.get('worker.maxRetryCount') || 3;
    this.maxConcurrency = this.configService.get('worker.maxCommandConcurrency') || 100;
    this.CHUNK_SIZE = this.configService.get('worker.migrationChunkSize') || 1024 * 1024;
    this.logger = loggerFactory.create(MigrationSyncService.name);
  }

  async calculateChecksum(filePath: string): Promise<string> {
     const isFilePathExists = await isPathExists(filePath);
     if (!isFilePathExists) {
        throw new Error(`File not found: ${filePath}`);
      }
    return new Promise((resolve, reject) => {           
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', (err) => reject(err));
    });
  }

  async copyFileWithChecksum(sourceFile: string, destinationFile: string): Promise<{sourceChecksum: string, targetChecksum:string}> {
    const sourceExists = await isPathExists(sourceFile);
    if (!sourceExists) {
      throw new Error(`Source file does not exist: ${sourceFile}`);
    }

    const destDir = path.dirname(destinationFile);
    const destDirExists = await isPathExists(destDir);

    if (!destDirExists) {
      await fs.promises.mkdir(destDir, { recursive: true });
    }
  
    const hash = crypto.createHash("sha256");
  
    await new Promise<void>((resolve, reject) => {
      const readStream = fs.createReadStream(sourceFile, {
        highWaterMark: this.CHUNK_SIZE,
      });
      const writeStream = fs.createWriteStream(destinationFile);
  
      readStream.on("data", (chunk) => {
        hash.update(chunk);
        if (!writeStream.write(chunk)) readStream.pause();
      });
  
      writeStream.on("drain", () => readStream.resume());
  
      readStream.on("end", () => writeStream.end());
      writeStream.on("finish", resolve);
      readStream.on("error", reject);
      writeStream.on("error", reject);

    });
  
    const sourceChecksum = hash.digest("hex");
    const targetChecksum = await this.calculateChecksum(destinationFile);
  
    if (sourceChecksum !== targetChecksum) {
      throw new Error(`Checksum mismatch for file ${destinationFile}. Checksum: ${sourceChecksum} != ${targetChecksum}`);
    }
    return {sourceChecksum, targetChecksum};
  }


  async ensureDirectoryExists(directoryPath: string) {
    const dirExists = await isPathExists(directoryPath);
    if (!dirExists) {
      await fs.promises.mkdir(directoryPath, { recursive: true });
    }
  }
  
  async stampMetaData(targetPath: string, sourcePath: string,  metadata: MetaData, jobContext: JobContext, command: Command, errorType: ErrorType):Promise<StampMetaDataOutput> {
    const stampMetaDataOutput : StampMetaDataOutput = {sourceErrors: [], targetErrors:[], errorType: errorType}
    if(metadata?.mode) {
      try {
        await fs.promises.chmod(targetPath, metadata.mode);
      } catch(error) {
        const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META,stampMetaDataOutput.errorType, command.commandId, error, {name: command.fPath, path: targetPath});
        await jobContext.appendToErrorList(dmErr);
        stampMetaDataOutput.targetErrors.push(error.code)
        this.logger.error(`Error setting file mode: ${error.message}`);
      }
     }
    if(metadata?.birthtime && command.ops[0].cmd !== OPS_CMD.COPY_DIR){
      try { 
        if(process.platform == 'win32') {
          const birthtime = new Date(metadata.birthtime) 
          var dateString = new Date(
            birthtime.getTime() - birthtime.getTimezoneOffset() * 60000
          );
          var birth_time = dateString.toISOString().replace("T", " ").substr(0, 19);
          const birthtimeCommand = `(Get-Item '${targetPath}').CreationTime = [System.DateTime]::ParseExact('${birth_time}', 'yyyy-MM-dd HH:mm:ss', $null)`;
          const output = await this.shellService.runCommand(birthtimeCommand);
          this.logger.debug(`Output of setting birthtime for ${targetPath} is ${output} and birthtime is ${birth_time} and metadata.birthtime is ${metadata.birthtime}`)
        }else {
          const birthtimeCommand = `touch -t ${formatDate(new Date(metadata.birthtime))} ${targetPath}`;
          await this.shellService.runCommand(birthtimeCommand);
        }
      } catch(error) {
        this.logger.error(`Error setting file timestamps: ${error.message}`);
        const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, stampMetaDataOutput.errorType, command.commandId, error, {name: command.fPath, path: targetPath});
        stampMetaDataOutput.targetErrors.push(error.code)
        await jobContext.appendToErrorList(dmErr);
      }
    }
    
    if(metadata.gid && metadata.uid && process.platform  !== 'win32') {
      try {
        let gid = metadata.gid?.toString();
        let uid = metadata.uid?.toString();
        if(jobContext.jobConfig.options.isIdentityMappingAvailable) {
          gid = await this.redisService.getOwnerIdentity(jobContext.jobRunId, metadata.gid?.toString(), 'GID')
          uid = await this.redisService.getOwnerIdentity(jobContext.jobRunId, metadata.uid?.toString(), 'UID')
        }
        if(gid && uid)
          await fs.promises.chown(targetPath, parseInt(uid), parseInt(gid));
      } catch(error) {
        this.logger.error(`Error setting ownership: ${error.message}`);
        const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, stampMetaDataOutput.errorType, command.commandId, error, {name: command.fPath, path: targetPath});
        stampMetaDataOutput.targetErrors.push(error.code)
        await jobContext.appendToErrorList(dmErr);
      }
    }
     
    if(process.platform === 'win32') {
      try{
        metadata.sid = await this.getSID(sourcePath);
      }
      catch(error) {
        this.logger.error(`Error setting ownership: ${error.message}`);
        const dmErr = dmError("OPERATION", Origin.SOURCE, Operation.STAMP_META, stampMetaDataOutput.errorType, command.commandId, error, {name: command.fPath, path: targetPath});
        stampMetaDataOutput.sourceErrors.push(error.code)
        await jobContext.appendToErrorList(dmErr);
      }
      try{
        const usersAcls:ACL[] = getUserACLs(metadata.sid, sourcePath)
        await Promise.all(
          usersAcls.map(async (userAcl) => {
            const user = !jobContext.jobConfig.options.isIdentityMappingAvailable ?  userAcl.user : await this.redisService.getOwnerIdentity(jobContext.jobRunId, userAcl.user, 'SID');
            if (user) {
              const commandExec = command.ops[0].cmd !== OPS_CMD.COPY_DIR
                ? CommandPattern.SET_SID_FOR_OBJECT
                : CommandPattern.SET_SID_FOR_OBJECT_DIR;
              const rawCommand = CommandConfig.getSMBCommand(process.platform, commandExec);
              let setSIDCommand = rawCommand
                .replace('${PATH}', targetPath)
                .replace('${USER}', user)
                .replace('${ACL}', userAcl.permissions);
                this.logger.warn(` setSIDCommand : ${setSIDCommand}`)
                const output = await this.shellService.runCommand(setSIDCommand);
                this.logger.debug(` output : ${output}`)
            }
          })
        );
      } catch(error) {
        this.logger.error(`Error setting ownership: ${error.message}`);
        const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, stampMetaDataOutput.errorType, command.commandId, error, {name: command.fPath, path: targetPath});
        stampMetaDataOutput.targetErrors.push(error.code)
        await jobContext.appendToErrorList(dmErr);
      }
    }
    
    if(metadata.mtime && metadata.atime) {
      try {
        await fs.promises.utimes(
          targetPath,
          new Date(metadata.atime),
          new Date(metadata.mtime)
        );
      } catch(error) {
        this.logger.error(`Error setting file timestamps: ${error.message}`);
        const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_TIME, stampMetaDataOutput.errorType, command.commandId, error, {name: command.fPath, path: targetPath});
        stampMetaDataOutput.targetErrors.push(error.code)
        await jobContext.appendToErrorList(dmErr);
      }
     }

    if(metadata.mtime && metadata.atime && jobContext.jobConfig.options.preserveAccessTime) {
      try {
        await fs.promises.utimes(
          sourcePath,
          new Date(metadata.atime),
          new Date(metadata.mtime)
        );
      } catch(error) {
        this.logger.error(`Error preserving file timestamps: ${error.message}`);
        const dmErr = dmError("OPERATION", Origin.SOURCE, Operation.STAMP_TIME, stampMetaDataOutput.errorType, command.commandId, error, {name: command.fPath, path: targetPath});
        stampMetaDataOutput.sourceErrors.push(error.code)
        await jobContext.appendToErrorList(dmErr);
      }
    }
    return stampMetaDataOutput
  }
  
  async syncOperation({ sourcePath, targetPath, ops, jobContext, command, errorType }: SyncOperationInput): Promise<SyncOperationOutput> {
    const syncOperation: SyncOperationOutput = {errors : {source: new Set<string>(), target: new Set<string>() },  ops, status: OPS_STATUS.COMPLETED , errorType : errorType }
    if (syncOperation.ops[0] && syncOperation.ops[0].status !== OPS_STATUS.COMPLETED) {
      if(syncOperation.ops[0].cmd === OPS_CMD.COPY_CONTENT) {
        try {
          syncOperation.checksums = await this.workerThreadService.migrateWorkerThread({
            sourcePath, destinationPath: targetPath, operationId: command.commandId, size: syncOperation.ops[1].metadata?.size ?? 0
          });
          syncOperation.ops[0] = { ...ops[0], status: OPS_STATUS.COMPLETED, checksum: syncOperation.checksums } as any;
        } catch (error) {
          syncOperation.ops[0] = { ...ops[0], status: OPS_STATUS.ERROR, error: error.message } ;
          this.logger.error(`Copying DIR from ${sourcePath} to ${targetPath}`);
          const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.COPY_CONTENT, syncOperation.errorType, command.commandId, error, {name: command.fPath, path: targetPath});
          await jobContext.appendToErrorList(dmErr);
          syncOperation.errors.target.add(error.code)
          this.logger.error(`Error in SyncOperation File: ${error.message} | ${error?.code}`);
          return syncOperation
        }
      }
      if(syncOperation.ops[0].cmd === OPS_CMD.COPY_DIR) {
        try {
          await this.ensureDirectoryExists(targetPath);
          syncOperation.ops[0] = { ...ops[0], status: OPS_STATUS.COMPLETED };
        } catch (error) {
          syncOperation.ops[0] = { ...ops[0], status: OPS_STATUS.ERROR, error: error.message };
          this.logger.error(`Copying DIR from ${sourcePath} to ${targetPath}`);
          const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.COPY_CONTENT, syncOperation.errorType, command.commandId, error, {name: command.fPath, path: targetPath});
          await jobContext.appendToErrorList(dmErr);
          this.logger.error(`Error in SyncOperation Dir: ${error.message}`);
          return syncOperation
        }
      }
    }
    if (syncOperation.ops[1]?.status !== OPS_STATUS.COMPLETED) {
      const result = await this.stampMetaData(targetPath, sourcePath, ops[1].metadata, jobContext, command, errorType)
      result.sourceErrors.forEach(error => syncOperation.errors.source.add(error))
      result.targetErrors.forEach(error => syncOperation.errors.target.add(error))
      syncOperation.ops[1].status = result.targetErrors.length || result.sourceErrors.length > 0 ? OPS_STATUS.ERROR : OPS_STATUS.COMPLETED
    }
    return syncOperation ;
  }

  async syncTaskActivity({ jobRunId , failedWorkers}: SyncTaskInput): Promise<SyncTaskOutput> {
    const syncTask: SyncTaskOutput = { errors: {source: new Set<string>(), target: new Set<string>()}, success: 0, error: 0, retryCount : 0, isFatal: false, noTaskFound: false, workerId: this.workerId };
    const jobContext: JobContext = await this.redisService.getJobContext(jobRunId);
    
    if(failedWorkers.includes(this.workerId)) {
      this.logger.debug(`[${jobRunId}] Worker already failed => ${this.workerId}`);
      syncTask.noTaskFound = true;
      syncTask.isFatal = true;
      return syncTask
    }
    
    let task  = await jobContext.getSyncTask(this.workerId);
    if(!task) task = await await this.commonService.fetchOneMigrationTask(jobContext);
    if(!task) {
      syncTask.noTaskFound = true;
      return syncTask;
    }
    await jobContext.setSyncTask(this.workerId, task);
  
    this.logger.debug(`[${jobRunId}] Found Task => ${task?.id} | stats : ${task?.status} | command : ${task?.commands?.length}`);

    task.status = TaskStatus.RUNNING
    task.workerId = this.workerId
    for (let i = 0;  i < task.commands.length; i++) 
      if(task.commands[i].status !== CommandStatus.COMPLETED)
        task.commands[i].status = CommandStatus.IN_PROCESS


    this.logger.debug(`[${jobRunId}] Running Task => ${task?.id} | stats : ${task?.status} | command : ${task?.commands?.length}`);
    
    jobContext.migrateTask.lastId = await jobContext.appendToUpdatedTaskList(task);
    await this.redisService.setJobContext(task.jobRunId, jobContext);

    const baseSourcePrefixPath = basePrefix(task.jobRunId, task.sPathId);
    const baseTargetPrefixPath = basePrefix(task.jobRunId, task.tPathId);

    for (let i = 0; i < task.commands.length; i += this.maxConcurrency) {
      const batch = task.commands.slice(i, i + this.maxConcurrency);
  
      await Promise.allSettled(
          batch.map(async (command) => {
              if (command.status === CommandStatus.COMPLETED) return;
  
              const scanInput: SyncOperationInput = {
                  sourcePath: `${baseSourcePrefixPath}${command.fPath}`,
                  targetPath: `${baseTargetPrefixPath}${command.fPath}`,
                  ops: command.ops,
                  command,
                  jobContext,
                  errorType: command.retryCount+1 >= this.maxRetryCount ? ErrorType.TRANSIENT_ERROR : ErrorType.RECOVERABLE_ERROR
              };
  
              const syncOperationOp: SyncOperationOutput = await this.syncOperation(scanInput);
              command.ops = syncOperationOp.ops;
              if (syncOperationOp.errors.source.size > 0 || syncOperationOp.errors.target.size > 0) {
                  command.retryCount++;
                  syncTask.retryCount = Math.max(command.retryCount, syncTask.retryCount);
                  command.status = CommandStatus.ERROR;
                  syncOperationOp.errors.source.forEach(error => syncTask.errors.source.add(error));
                  syncOperationOp.errors.target.forEach(error => syncTask.errors.target.add(error));
                  syncTask.error++;
              } else {
                  const fileInfo: FileInfo = await this.getFileInfo({
                      name: command.fPath,
                      fullFilePath: `${task.tPath}${command.fPath}`,
                      relativePath: command.fPath,
                      checksums: syncOperationOp.checksums,
                      getID: jobContext.jobConfig.options.isIdentityMappingAvailable
                  });
  
                  jobContext.filesInfo.lastId = await jobContext.appendToFileList(fileInfo);
                  jobContext.filesInfo.numMessages++;
                  command.status = CommandStatus.COMPLETED;
                  await jobContext.setSyncTask(this.workerId, task);
                  syncTask.success++;
  
                  await this.redisService.setJobContext(task.jobRunId, jobContext);
              }
          })
      );
    }
    if(syncTask.error > 0 && syncTask.retryCount >= this.maxRetryCount)  
      task.status = TaskStatus.ERRORED 
    else if( syncTask.retryCount > 0) 
      task.status = TaskStatus.COMPLETED_WITH_ERROR 
    else 
      task.status = TaskStatus.COMPLETED
     
    if( syncTask.error > 0) {
      for(const error of syncTask.errors.target)
        if(isFatalError(error)) {
          syncTask.isFatal = true;
          break;
        }

      for(const error of syncTask.errors.source)
        if(isSourceFatalError(error)) {
          syncTask.isFatal = true;
          break;
        }
        
      const errorType = syncTask.isFatal ? ErrorType.FATAL_ERROR : syncTask.retryCount >= this.maxRetryCount ? ErrorType.TRANSIENT_ERROR : ErrorType.RECOVERABLE_ERROR;
      const dmErr = dmError("TASK", Origin.DESTINATION,  Operation.COPY_CONTENT, errorType, task.id,  undefined, undefined, {
          errorCode: syncTask.errors.target.size > 0 || syncTask.errors.source.size > 0 ? [...Array.from(syncTask.errors.target), ...Array.from(syncTask.errors.source)] : [], 
          message: `Task ${task.id} has ${syncTask.error} errors and ${syncTask.success} success during sync`
      });
      jobContext.errorsInfo.lastId = await jobContext.appendToErrorList(dmErr);
      if(errorType===ErrorType.TRANSIENT_ERROR || errorType===ErrorType.FATAL_ERROR)
        task.status = TaskStatus.ERRORED;
      if(syncTask.retryCount < this.maxRetryCount && !syncTask.isFatal) {
        this.logger.debug(`[${jobRunId}] Appending to Retry => ${task?.id} | stats : ${task?.status} | command : ${task?.commands?.length}`);
        jobContext.migrateTask.lastId = await jobContext.appendToMigrationTask(task);
      }
      else if(syncTask.isFatal){
        this.logger.debug(`[${jobRunId}] Fatal Error Detected for task => ${task?.id} | stats : ${task?.status} | command : ${task?.commands?.length} `)
        task.status = TaskStatus.ERRORED;
        jobContext.updatedTaskInfo.lastId = await jobContext.appendToUpdatedTaskList(task);
      }
    }else {
      this.logger.debug(`[${jobRunId}] Completed Task => ${task?.id} | stats : ${task?.status} | command : ${task?.commands?.length}`);
      jobContext.updatedTaskInfo.lastId = await jobContext.appendToUpdatedTaskList(task);
    }
    await this.redisService.setJobContext(task.jobRunId, jobContext);
    await jobContext.deleteSyncTask(this.workerId);
    return syncTask;
  }

  getFileInfo = async ({name, fullFilePath, relativePath, checksums, getID}: getFileInfoInput): Promise<any>  => {
      const lStat = await fs.promises.lstat(fullFilePath);
      const isDirectory = lStat.isDirectory();
      let sid = undefined
      if(getID && process.platform == 'win32' && lStat.isFile())
        sid = this.getSID(fullFilePath);
      const obj = new FileInfo(
          name,
          relativePath,
          relativePath,
          isDirectory,
          lStat.size,
          !isDirectory,
          lStat.birthtime,
          lStat.mtime,
          lStat.atime,
          path.extname(fullFilePath),
          getFilePermissions(lStat, isDirectory),
          getFileType(lStat, isDirectory),
          relativePath.split('/').length - 2,
          lStat.uid,
          lStat.gid,
        );
      return {
        ...obj,
        ...checksums,
        sid
      }
  }
  getSID = async (filePath: string) => {
    const getSIDCommand = CommandConfig.getSMBCommand(process.platform, CommandPattern.GET_SID_FOR_OBJECT)?.replaceAll('${PATH}', filePath);
    return await this.shellService.runCommand(getSIDCommand);
  }

  async syncTask({ jobRunId , failedWorkers}: SyncTaskInput): Promise<SyncTaskOutput> {
    const ctx = Context.current();
    const interval = setInterval(() => { ctx.heartbeat({ workerId: this.workerId }) }, 10000);
    try {
        return this.syncTaskActivity({ jobRunId, failedWorkers });
    } finally {
        clearInterval(interval);
    }
  }


}
