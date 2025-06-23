import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandStatus, ErrorType, FileInfo, JobManagerContext, OPS_STATUS, Task, TaskStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import { Context } from '@temporalio/activity';
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { ShellService } from 'src/activities/common/shell.service';
import { ACL, getFileInfoInput, Operation, Origin } from 'src/activities/utils/utils.types';
import { CommandConfig, CommandPattern } from 'src/config/command.config';
import { RedisService } from 'src/redis/redis.service';
import { WorkerThreadService } from 'src/thread/worker.thread.service';
import { basePrefix, dmError, formatDate, getFilePermissions, getFileType, getUserACLs, isFatalError, isSourceFatalError } from '../../utils/utils';
import { OPS_CMD, } from '../migrate.type';
import { handleInitTaskInput, handleSyncTaskUpdateInput, StampMetaDataInput, StampMetaDataOutput, SyncOperationInput, SyncOperationOutput, SyncTaskInput, SyncTaskOutput } from './migrate-sync.types';
import { FatalError, RetryableError } from 'src/errors/errors.types';


const isRandomTrue = (probability: number) => {
  if (probability < 0 || probability > 1) {
    throw new Error('Probability must be between 0 and 1');
  }
  return Math.random() < probability;
};

@Injectable()
export class MigrateSyncService {
  readonly workerId: string;
  readonly CHUNK_SIZE: number;
  readonly maxRetryCount: number;
  readonly maxConcurrency: number;
  
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    private readonly logger: Logger,
    private readonly redisService: RedisService,
    private readonly shellService: ShellService,
    private readonly workerThreadService: WorkerThreadService,
  ) {
    this.workerId = this.configService.get('worker.workerId');
    this.maxRetryCount = this.configService.get('worker.maxRetryCount') || 3;
    this.maxConcurrency = this.configService.get('worker.maxCommandConcurrency') || 100;
    this.CHUNK_SIZE = this.configService.get('worker.migrationChunkSize') || 1024 * 1024;
  }

  async calculateChecksum(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(filePath)) {
        return reject(new Error(`File not found: ${filePath}`));
      }
      
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', (err) => reject(err));
    });
  }

  async copyFileWithChecksum(sourceFile: string, destinationFile: string): Promise<{sourceChecksum: string, targetChecksum:string}> {
    if (!fs.existsSync(sourceFile)) {
      throw new Error(`Source file does not exist: ${sourceFile}`);
    }

    const destDir = path.dirname(destinationFile);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
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


  ensureDirectoryExists(directoryPath: string) {
    if (!fs.existsSync(directoryPath)) {
      fs.mkdirSync(directoryPath, { recursive: true });
    }
  }
  
  async stampMetaData({sourcePath, metadata, command, errorType, jobContext, targetPath}: StampMetaDataInput):Promise<StampMetaDataOutput> {
    const stampMetaDataOutput : StampMetaDataOutput = {sourceErrors: [], targetErrors:[], errorType: errorType}
    if(metadata?.mode) {
      try {
        await fs.promises.chmod(targetPath, metadata.mode);
      } catch(error) {
        const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META,stampMetaDataOutput.errorType, command.commandId, error, {name: command.fPath, path: targetPath});
        await jobContext.publishToErrorStream(dmErr);
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
        await jobContext.publishToErrorStream(dmErr);
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
        await jobContext.publishToErrorStream(dmErr);
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
        await jobContext.publishToErrorStream(dmErr);
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
        await jobContext.publishToErrorStream(dmErr);
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
        await jobContext.publishToErrorStream(dmErr);
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
        await jobContext.publishToErrorStream(dmErr);
      }
    }
    return stampMetaDataOutput
  }
  
  async syncOperation({ sourcePath, targetPath, ops, jobContext, command, errorType }: SyncOperationInput): Promise<SyncOperationOutput> {
    const syncOperation: SyncOperationOutput = {errors : {source: new Set<string>(), target: new Set<string>() },  ops, status: OPS_STATUS.COMPLETED , errorType : errorType }
    if (syncOperation.ops[0] && syncOperation.ops[0].status !== OPS_STATUS.COMPLETED) {
      if(syncOperation.ops[0].cmd === OPS_CMD.COPY_CONTENT) {
        try {
          if(isRandomTrue(0.80)) throw new Error("Random Error for testing");
          syncOperation.checksums = await this.workerThreadService.migrateWorkerThread({
            sourcePath, destinationPath: targetPath, operationId: command.commandId, size: syncOperation.ops[1].metadata?.size ?? 0
          });
          syncOperation.ops[0] = { ...ops[0], status: OPS_STATUS.COMPLETED, checksum: syncOperation.checksums } as any;
        } catch (error) {
          syncOperation.ops[0] = { ...ops[0], status: OPS_STATUS.ERROR, error: error.message } ;
          this.logger.error(`Copying DIR from ${sourcePath} to ${targetPath}`);
          const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.COPY_CONTENT, syncOperation.errorType, command.commandId, error, {name: command.fPath, path: targetPath});
          await jobContext.publishToErrorStream(dmErr);
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
          await jobContext.publishToErrorStream(dmErr);
          this.logger.error(`Error in SyncOperation Dir: ${error.message}`);
          return syncOperation
        }
      }
    }
    if (syncOperation.ops[1]?.status !== OPS_STATUS.COMPLETED) {
      const result = await this.stampMetaData({targetPath, sourcePath, metadata: ops[1].metadata, jobContext, command, errorType})
      result.sourceErrors.forEach(error => syncOperation.errors.source.add(error))
      result.targetErrors.forEach(error => syncOperation.errors.target.add(error))
      syncOperation.ops[1].status = result.targetErrors.length || result.sourceErrors.length > 0 ? OPS_STATUS.ERROR : OPS_STATUS.COMPLETED
    }
    return syncOperation ;
  }

  async syncTaskActivity({ jobRunId, taskId }: SyncTaskInput): Promise<SyncTaskOutput> {
    const syncActivityCtx= Context.current();
    const heartBeatInterval = setInterval(() => { syncActivityCtx.heartbeat({});}, 2000);

    const syncOutput: SyncTaskOutput = { errors: { source: [], target: [] }, status: TaskStatus.PENDING, error: 0, retryCount: 0};
    const jobContext: JobManagerContext = await this.redisService.getJobManagerContext(jobRunId);
    let task = undefined;
    try {
      task = await jobContext.getTask(taskId);
      if (!task) {
        this.logger.warn(`[${jobRunId}] No Task Found for taskId: ${taskId}`);
        return syncOutput;
      }

      this.logger.debug(`[${jobRunId}] Found Task => ${task?.id} | status : ${task?.status} | command : ${task?.commands?.length}`);

      task = await this.validateTask({ task, jobContext });
      task.status = TaskStatus.RUNNING;
      task.workerId = this.workerId;
      await jobContext.publishToTaskStream(task);

      const baseSourcePrefixPath = basePrefix(task.jobRunId, task.sPathId);
      const baseTargetPrefixPath = basePrefix(task.jobRunId, task.tPathId);

      for (const [index, command] of task.commands.entries()) {
        if (command.status === CommandStatus.COMPLETED) continue;
        const scanInput: SyncOperationInput = {
          sourcePath: `${baseSourcePrefixPath}${command.fPath}`,
          targetPath: `${baseTargetPrefixPath}${command.fPath}`,
          ops: command.ops,
          command,
          jobContext,
          errorType: command.retryCount + 1 >= this.maxRetryCount ? ErrorType.TRANSIENT_ERROR : ErrorType.RECOVERABLE_ERROR
        };
        //TODO: revisit and improve this .
        const syncOperationOp: SyncOperationOutput = await this.syncOperation(scanInput);
        if (syncOperationOp.errors.source.size > 0 || syncOperationOp.errors.target.size > 0) {
          command.retryCount++;
          syncOutput.retryCount = Math.max(command.retryCount, syncOutput.retryCount);
          command.status = CommandStatus.ERROR;
          syncOperationOp.errors.source.forEach(error => syncOutput.errors.source.push(error));
          syncOperationOp.errors.target.forEach(error => syncOutput.errors.target.push(error));
        } else {
          const fileInfo: FileInfo = await this.getFileInfo({
            name: command.fPath,
            fullFilePath: `${task.tPath}${command.fPath}`,
            relativePath: command.fPath,
            checksums: syncOperationOp.checksums,
            getID: jobContext.jobConfig.options.isIdentityMappingAvailable
          });

          await jobContext.publishToFileStream(fileInfo);
          command.status = CommandStatus.COMPLETED;
          //TODO:  can we do this in batch?
        }
        await jobContext.setTask(taskId, task);
      }
      await this.handleUpdateTask({ taskHashId: taskId, jobContext, errors: syncOutput.errors, task, retryCount: syncOutput.retryCount });
      syncOutput.status = TaskStatus.COMPLETED;
    } catch (error) {
      // if(error instanceof FatalError) 
      //   throw error;
      this.logger.error(`[${jobRunId}] Error in syncTaskActivity: ${error.message}`, error.stack);
      throw new RetryableError("SyncTaskActivity Failed: " + error.message);
    }
    finally{
      clearInterval(heartBeatInterval);
    }
    return syncOutput;
  }

  getFileInfo = async ({name, fullFilePath, relativePath, checksums, getID}: getFileInfoInput): Promise<any>  => {
      const lStat = await fs.promises.lstat(fullFilePath);
      let sid = undefined
      if(getID && process.platform == 'win32' && lStat.isFile())
        sid = this.getSID(fullFilePath);
      const obj = new FileInfo(
          name,
          relativePath,
          relativePath,
          lStat.isDirectory(),
          lStat.size,
          !lStat.isDirectory(),
          lStat.birthtime,
          lStat.mtime,
          lStat.atime,
          path.extname(fullFilePath),
          getFilePermissions(lStat),
          getFileType(lStat),
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



  async handleUpdateTask({errors, jobContext , taskHashId , task , retryCount}: handleSyncTaskUpdateInput): Promise<void> {
    if(task.commands.every(cmd => cmd.status === CommandStatus.COMPLETED)) {
      task.status = TaskStatus.COMPLETED;
      await jobContext.publishToTaskStream(task);
      await jobContext.deleteTask(taskHashId);
      return
    }

    if((errors.source.length > 0 || errors.target.length > 0) && (retryCount > this.maxRetryCount)) {
      task.status = TaskStatus.ERRORED;
      await jobContext.publishToTaskStream(task);
      await jobContext.deleteTask(taskHashId);

    for(const error of errors.source)
      if(isSourceFatalError(error)) 
        throw new FatalError(`Fatal Error in Sync Task From Source Side: ${error}`);

    for(const error of errors.target)
      if(isFatalError(error)) 
        throw new FatalError(`Fatal Error in Sync Task From Target Side: ${error}`);  
    }

    throw new RetryableError(`Sync Task Update Failed: ${errors.source.length} source errors and ${errors.target.length} target errors with retry count ${retryCount}`);
  }


  async validateTask({task , jobContext}: handleInitTaskInput) : Promise<Task> {
    let retryCount = 0;
    for (let i = 0; i < task.commands.length; i++) {
      retryCount = Math.max(retryCount, task.commands[i].retryCount);
      if (task.commands[i].status !== CommandStatus.COMPLETED)
        task.commands[i].status = CommandStatus.IN_PROCESS
    }

    if (retryCount >= this.maxRetryCount) {
      task.status = TaskStatus.ERRORED;
      await jobContext.publishToTaskStream(task);
      throw new FatalError(`Task ${task.id} has exceeded maximum retry count of ${this.maxRetryCount}`);
    }

    return task;
  }
}

