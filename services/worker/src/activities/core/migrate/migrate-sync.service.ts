import { JobManger } from '@local/job-lib';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandStatus, ErrorType, FileInfo, OPS_STATUS, Task, TaskStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import { Context } from '@temporalio/activity';
import * as fs from "fs";
import * as path from "path";
import { ShellService } from 'src/activities/common/shell.service';
import { ACL, getFileInfoInput, Operation, Origin } from 'src/activities/utils/utils.types';
import { CommandConfig, CommandPattern } from 'src/config/command.config';
import { FatalError, RetryableError, RetryExceededError } from 'src/errors/errors.types';
import { RedisService } from 'src/redis/redis.service';
import { WorkerThreadService } from 'src/thread/worker.thread.service';
import { OPS_CMD, } from '../../migrate/migrate.type';
import { basePrefix, dmError, formatDate, getFilePermissions, getFileType, getUserACLs, isFatalError, isSourceFatalError } from '../../utils/utils';
import { CommonTaskService } from '../common/common-task.service';
import { handleSyncTaskUpdateInput, StampMetaDataInput, StampMetaDataOutput, SyncOperationInput, SyncOperationOutput, SyncTaskInput, SyncTaskOutput } from './migrate-sync.types';


// const isRandomTrue = (probability: number) => {
//   if (probability < 0 || probability > 1) {
//     throw new Error('Probability must be between 0 and 1');
//   }
//   return Math.random() < probability;
// };

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
    private readonly commonTaskService: CommonTaskService,
    private readonly jobManager: JobManger
  ) {
    this.workerId = this.configService.get('worker.workerId');
    this.maxRetryCount = this.configService.get('worker.maxRetryCount') || 3;
    this.maxConcurrency = this.configService.get('worker.maxCommandConcurrency') || 100;
    this.CHUNK_SIZE = this.configService.get('worker.migrationChunkSize') || 1024 * 1024;
  }



  ensureDirectoryExists(directoryPath: string) {
    if (!fs.existsSync(directoryPath)) {
      fs.mkdirSync(directoryPath, { recursive: true });
    }
  }
  
  async stampMetaData({sourcePath, metadata, command, errorType, jobRunId, targetPath, jobConfig}: StampMetaDataInput):Promise<StampMetaDataOutput> {
    //TODO: change the command class to replace ops with steps. 
    const stampMetaDataOutput : StampMetaDataOutput = {sourceErrors: [], targetErrors:[], errorType: errorType}
    if(metadata?.mode) {
      try {
        await fs.promises.chmod(targetPath, metadata.mode);
      } catch(error) {
        const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META,stampMetaDataOutput.errorType, command.commandId, error, {name: command.fPath, path: targetPath});
        await this.jobManager.publishToErrorStream(jobRunId,dmErr);
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
        await this.jobManager.publishToErrorStream(jobRunId, dmErr);
      }
    }
    
    if(metadata.gid && metadata.uid && process.platform  !== 'win32') {
      try {
        let gid = metadata.gid?.toString();
        let uid = metadata.uid?.toString();
        if(jobConfig.options.isIdentityMappingAvailable) {
          gid = await this.redisService.getOwnerIdentity(jobRunId, metadata.gid?.toString(), 'GID')
          uid = await this.redisService.getOwnerIdentity(jobRunId, metadata.uid?.toString(), 'UID')
        }
        if(gid && uid)
          await fs.promises.chown(targetPath, parseInt(uid), parseInt(gid));
      } catch(error) {
        this.logger.error(`Error setting ownership: ${error.message}`);
        const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, stampMetaDataOutput.errorType, command.commandId, error, {name: command.fPath, path: targetPath});
        stampMetaDataOutput.targetErrors.push(error.code)
        await this.jobManager.publishToErrorStream(jobRunId, dmErr);
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
        await this.jobManager.publishToErrorStream(jobRunId, dmErr);
      }
      try{
        const usersAcls:ACL[] = getUserACLs(metadata.sid, sourcePath)
        await Promise.all(
          usersAcls.map(async (userAcl) => {
            const user = !jobConfig.options.isIdentityMappingAvailable ?  userAcl.user : await this.redisService.getOwnerIdentity(jobRunId, userAcl.user, 'SID');
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
        await this.jobManager.publishToErrorStream(jobRunId, dmErr);
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
        await this.jobManager.publishToErrorStream(jobRunId, dmErr);
      }
     }

    if(metadata.mtime && metadata.atime && jobConfig.options.preserveAccessTime) {
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
        await this.jobManager.publishToErrorStream(jobRunId, dmErr);
      }
    }
    return stampMetaDataOutput
  }
  
  async syncOperation({ sourcePath, targetPath, ops, jobRunId, command, errorType , jobConfig }: SyncOperationInput): Promise<SyncOperationOutput> {
    const syncOperation: SyncOperationOutput = {errors : {source: new Set<string>(), target: new Set<string>() },  ops, status: OPS_STATUS.COMPLETED , errorType : errorType }
    if (syncOperation.ops[0] && syncOperation.ops[0].status !== OPS_STATUS.COMPLETED) {
      if(syncOperation.ops[0].cmd === OPS_CMD.COPY_CONTENT) {
        try {
          // if(isRandomTrue(0.10)) throw new Error("Random Error for testing");
          syncOperation.checksums = await this.workerThreadService.migrateWorkerThread({
            sourcePath, destinationPath: targetPath, operationId: command.commandId, size: syncOperation.ops[1].metadata?.size ?? 0
          });
          syncOperation.ops[0] = { ...ops[0], status: OPS_STATUS.COMPLETED, checksum: syncOperation.checksums } as any;
        } catch (error) {
          syncOperation.ops[0] = { ...ops[0], status: OPS_STATUS.ERROR, error: error.message } ;
          this.logger.error(`Copying DIR from ${sourcePath} to ${targetPath}`);
          const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.COPY_CONTENT, syncOperation.errorType, command.commandId, error, {name: command.fPath, path: targetPath});
          await this.jobManager.publishToErrorStream(jobRunId,dmErr);
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
          await this.jobManager.publishToErrorStream(jobRunId, dmErr);
          this.logger.error(`Error in SyncOperation Dir: ${error.message}`);
          return syncOperation
        }
      }
    }
    if (syncOperation.ops[1]?.status !== OPS_STATUS.COMPLETED) {
      const result = await this.stampMetaData({targetPath, sourcePath, metadata: ops[1].metadata, jobRunId, command, errorType, jobConfig})
      result.sourceErrors.forEach(error => syncOperation.errors.source.add(error))
      result.targetErrors.forEach(error => syncOperation.errors.target.add(error))
      syncOperation.ops[1].status = result.targetErrors.length || result.sourceErrors.length > 0 ? OPS_STATUS.ERROR : OPS_STATUS.COMPLETED
    }
    return syncOperation ;
  }

  async syncTaskActivity({ jobRunId, taskId }: SyncTaskInput): Promise<SyncTaskOutput> {
    const syncActivityCtx= Context.current();
    const heartBeatInterval = setInterval(() => { syncActivityCtx.heartbeat({});}, 2000);

    let syncOutput: SyncTaskOutput = { errors: { source: [], target: [] }, status: TaskStatus.PENDING, error: 0, retryCount: 0};

    let task = undefined;
    try {
      this.logger.warn(`-------------------------------------------`)

      task = await this.jobManager.getTask(jobRunId, taskId);
      this.logger.debug(JSON.stringify(task));
      this.logger.warn(`-------------------------------------------`)
      if (!task) {
        this.logger.warn(`[${jobRunId}] No Task Found for taskId: ${taskId}`);
        return syncOutput;
      }
      this.logger.debug(`[${jobRunId}] Found Task => ${task?.id} | status : ${task?.status} | command : ${task?.commands?.length}`);
      task = await this.commonTaskService.ensureTaskValid({ task, jobRunId });
      task.status = TaskStatus.RUNNING;
      task.workerId = this.workerId;
      await this.jobManager.publishToTaskStream(jobRunId, task);
      syncOutput = await this.executeSyncTask(taskId, task, jobRunId);
      await this.updateAndReportTaskStatus({ taskHashId: taskId, jobRunId, errors: syncOutput.errors, task, retryCount: syncOutput.retryCount });
      syncOutput.status = TaskStatus.COMPLETED;
    } catch (error) {
        if(error instanceof FatalError) throw error;
        this.logger.error(`[${jobRunId}] Error in syncTaskActivity: ${error.message}`, error.stack);        
        throw error;
    } finally {
      clearInterval(heartBeatInterval);
    }
    return syncOutput;
  }

  executeSyncTask = async (taskHashId:string, task: Task, jobRunId: string, ): Promise<SyncTaskOutput> => {
      const syncOutput: SyncTaskOutput = { errors: { source: [], target: [] }, status: TaskStatus.PENDING, error: 0, retryCount: 0};
      const baseSourcePrefixPath = basePrefix(task.jobRunId, task.sPathId);
      const baseTargetPrefixPath = basePrefix(task.jobRunId, task.tPathId);

      const jobConfig = await this.jobManager.getJobConfig(jobRunId);

      for (const command of task.commands) {
        if (command.status === CommandStatus.COMPLETED) continue;

        const scanInput: SyncOperationInput = {
          sourcePath: `${baseSourcePrefixPath}${command.fPath}`,
          targetPath: `${baseTargetPrefixPath}${command.fPath}`,
          ops: command.ops,
          command,
          jobRunId,
          jobConfig,
          errorType: command.retryCount + 1 >= this.maxRetryCount ? ErrorType.TRANSIENT_ERROR : ErrorType.RECOVERABLE_ERROR
        };
        //TODO: revisit and improve this. It is not trivial to read this. 
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
            getID: jobConfig.options.isIdentityMappingAvailable
          });
          command.status = CommandStatus.COMPLETED;
          await this.jobManager.publishToFileStream(jobRunId, fileInfo);          
        }
        // await this.jobManager.setTask(jobRunId,taskHashId, task);
      } 
      return syncOutput
  }

  //TODO: revisit this and see what all are not used. 
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
  // TODO: can be this depricated in future
  getSID = async (filePath: string) => {
    const getSIDCommand = CommandConfig.getSMBCommand(process.platform, CommandPattern.GET_SID_FOR_OBJECT)?.replaceAll('${PATH}', filePath);
    return await this.shellService.runCommand(getSIDCommand);
  }


  async updateAndReportTaskStatus({ errors, jobRunId, taskHashId, task, retryCount }: handleSyncTaskUpdateInput): Promise<void> {
    const allCompleted = task.commands.every(cmd => cmd.status === CommandStatus.COMPLETED);

    if (allCompleted) {
      task.status = TaskStatus.COMPLETED;
      await this.jobManager.publishToTaskStream( jobRunId, task);
      await this.jobManager.deleteTask( jobRunId, taskHashId);
      return;
    }

    const hasFatalSourceError = errors.source.some(isSourceFatalError);
    const hasFatalTargetError = errors.target.some(isFatalError);
    const isFatalErrored = hasFatalSourceError || hasFatalTargetError;

    task.status = TaskStatus.ERRORED;
    await this.jobManager.publishToTaskStream( jobRunId, task);

    if (isFatalErrored) {
      await this.jobManager.deleteTask(jobRunId,taskHashId);
      throw new FatalError(
        `Sync Task Update Failed: ${errors.source.length} source errors and ${errors.target.length} target errors with retry count ${retryCount}`
      );
    }

    if (retryCount >= this.maxRetryCount) {
      await this.jobManager.deleteTask(jobRunId, taskHashId);
      throw new RetryExceededError(
        `Task ${task.id} has exceeded maximum retry count of ${this.maxRetryCount}`
      );
    }

    throw new RetryableError(
      `Sync Task Update Failed: ${errors.source.length} source errors and ${errors.target.length} target errors with retry count ${retryCount}`
    );
  }
}

