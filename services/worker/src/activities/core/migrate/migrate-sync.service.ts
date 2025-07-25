import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandStatus, ErrorType, FileInfo, JobManagerContext, OPS_STATUS, Task, TaskStatus } from '@netapp-cloud-datamigrate/jobs-lib';
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
import { LoggerService, LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class MigrateSyncService {
  readonly workerId: string;
  readonly CHUNK_SIZE: number;
  readonly maxRetryCount: number;
  readonly maxConcurrency: number;
  private readonly logger : LoggerService;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly redisService: RedisService,
    private readonly shellService: ShellService,
    private readonly workerThreadService: WorkerThreadService,
    private readonly commonTaskService: CommonTaskService
  ) {
    this.workerId = this.configService.get('worker.workerId');
    this.maxRetryCount = this.configService.get('worker.maxRetryCount') || 3;
    this.maxConcurrency = this.configService.get('worker.maxCommandConcurrency') || 100;
    this.CHUNK_SIZE = this.configService.get('worker.migrationChunkSize') || 1024 * 1024;
    this.logger = loggerFactory.create(MigrateSyncService.name);
  }



  ensureDirectoryExists(directoryPath: string) {    
      fs.mkdirSync(directoryPath, { recursive: true });    
  }
  
  async stampMetaData({sourcePath, metadata, command, errorType, jobContext, targetPath}: StampMetaDataInput):Promise<StampMetaDataOutput> {
    //TODO: change the command class to replace ops with steps. 
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
        if (!this.validateSourceExist(sourcePath)) {
          syncOperation.ops[0] = { ...ops[0], status: OPS_STATUS.ERROR, error: `Source path does not exist: ${sourcePath}` };
          this.logger.error(`Source path does not exist: ${sourcePath}`);
          const dmErr = dmError("OPERATION", Origin.SOURCE, Operation.COPY_CONTENT, syncOperation.errorType, command.commandId, new Error(`Source path does not exist: ${sourcePath}`), {name: command.fPath, path: sourcePath});
          await jobContext.publishToErrorStream(dmErr);
          return syncOperation;
        }
        try {
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
    if (syncOperation.ops[0].cmd === OPS_CMD.REMOVE_DIR || syncOperation.ops[0].cmd === OPS_CMD.REMOVE_FILE) {
      if (syncOperation.ops[0]?.status !== OPS_STATUS.COMPLETED) {
        await this.removeFileOrDirectory({
          targetPath,
          ops,
          syncOperation,
          command,
          jobContext
        });
      }
      return syncOperation
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

    let syncOutput: SyncTaskOutput = { errors: { source: [], target: [] }, status: TaskStatus.PENDING, error: 0, retryCount: 0};
    const jobContext: JobManagerContext = await this.redisService.getJobManagerContext(jobRunId);
    let task = undefined;
    try {
      task = await jobContext.getTask(taskId);
      if (!task) {
        this.logger.warn(`[${jobRunId}] No Task Found for taskId: ${taskId}`);
        return syncOutput;
      }
      this.logger.debug(`[${jobRunId}] Found Task => ${task?.id} | status : ${task?.status} | command : ${task?.commands?.length}`);
      task = await this.commonTaskService.ensureTaskValid({ task, jobContext });
      task.status = TaskStatus.RUNNING;
      task.workerId = this.workerId;
      await jobContext.publishToTaskStream(task);
      syncOutput = await this.executeSyncTask(taskId, task, jobContext);
      await this.updateAndReportTaskStatus({ taskHashId: taskId, jobContext, errors: syncOutput.errors, task, retryCount: syncOutput.retryCount });
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

  executeSyncTask = async (taskHashId:string, task: Task, jobContext: JobManagerContext, ): Promise<SyncTaskOutput> => {
      const syncOutput: SyncTaskOutput = { errors: { source: [], target: [] }, status: TaskStatus.PENDING, error: 0, retryCount: 0};
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
        //TODO: revisit and improve this. It is not trivial to read this. 
        const syncOperationOp: SyncOperationOutput = await this.syncOperation(scanInput);
        if (syncOperationOp.errors.source.size > 0 || syncOperationOp.errors.target.size > 0) {
          command.retryCount++;
          syncOutput.retryCount = Math.max(command.retryCount, syncOutput.retryCount);
          command.status = CommandStatus.ERROR;
          syncOperationOp.errors.source.forEach(error => syncOutput.errors.source.push(error));
          syncOperationOp.errors.target.forEach(error => syncOutput.errors.target.push(error));
        } else if(command.ops[0].cmd != OPS_CMD.REMOVE_DIR && command.ops[0].cmd != OPS_CMD.REMOVE_FILE) {
          const fileInfo: FileInfo = await this.getFileInfo({
            name: command.fPath,
            fullFilePath: `${task.tPath}${command.fPath}`,
            relativePath: command.fPath,
            checksums: syncOperationOp.checksums,
            getID: jobContext.jobConfig.options.isIdentityMappingAvailable
          });
          command.status = CommandStatus.COMPLETED;
          await jobContext.publishToFileStream(fileInfo);
        } else {
          command.status = CommandStatus.COMPLETED;
        }

        await jobContext.setTask(taskHashId, task);
      }
      return syncOutput
  }

  //TODO: revisit this and see what all are not used. 
  getFileInfo = async ({name, fullFilePath, relativePath, checksums, getID}: getFileInfoInput): Promise<any>  => {
      const lStat = await fs.promises.lstat(fullFilePath);
      const isDirectory:boolean = lStat.isDirectory();
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
  // TODO: can be this depricated in future
  getSID = async (filePath: string) => {
    const getSIDCommand = CommandConfig.getSMBCommand(process.platform, CommandPattern.GET_SID_FOR_OBJECT)?.replaceAll('${PATH}', filePath);
    return await this.shellService.runCommand(getSIDCommand);
  }


  async updateAndReportTaskStatus({ errors, jobContext, taskHashId, task, retryCount }: handleSyncTaskUpdateInput): Promise<void> {
    const allCompleted = task.commands.every(cmd => cmd.status === CommandStatus.COMPLETED);

    if (allCompleted) {
      task.status = TaskStatus.COMPLETED;
      await jobContext.publishToTaskStream(task);
      await jobContext.deleteTask(taskHashId);
      return;
    }

    const hasFatalSourceError = errors.source.some(isSourceFatalError);
    const hasFatalTargetError = errors.target.some(isFatalError);
    const isFatalErrored = hasFatalSourceError || hasFatalTargetError;

    task.status = TaskStatus.ERRORED;
    await jobContext.publishToTaskStream(task);

    if (isFatalErrored) {
      await jobContext.deleteTask(taskHashId);
      throw new FatalError(
        `Sync Task Update Failed: ${errors.source.length} source errors and ${errors.target.length} target errors with retry count ${retryCount}`
      );
    }

    if (retryCount >= this.maxRetryCount) {
      await jobContext.deleteTask(taskHashId);
      throw new RetryExceededError(
        `Task ${task.id} has exceeded maximum retry count of ${this.maxRetryCount}`
      );
    }

    throw new RetryableError(
      `Sync Task Update Failed: ${errors.source.length} source errors and ${errors.target.length} target errors with retry count ${retryCount}`
    );
  }

  async removeFileOrDirectory({ targetPath, ops, syncOperation, command, jobContext }: { targetPath: string; ops: any; syncOperation: SyncOperationOutput; command: any; jobContext: JobManagerContext }): Promise<void> {
    try {
      if (syncOperation.ops[0].cmd === OPS_CMD.REMOVE_DIR) {
        await fs.promises.rm(targetPath, { recursive: true, force: true });
      } else {
        await this.safeUnlink(targetPath);
      }
      syncOperation.ops[0] = { ...ops[0], status: OPS_STATUS.COMPLETED };

    } catch (error) {
      syncOperation.ops[0] = { ...ops[0], status: OPS_STATUS.ERROR, error: error.message };
      this.logger.error(`Removing ${syncOperation.ops[0].cmd === OPS_CMD.REMOVE_DIR ? 'DIR' : 'FILE'} from ${targetPath}`);
      const dmErr = dmError("OPERATION", Origin.DESTINATION, syncOperation.ops[0].cmd === OPS_CMD.REMOVE_DIR ? Operation.REMOVE_DIR : Operation.REMOVE_FILE, syncOperation.errorType, command.commandId, error, { name: command.fPath, path: targetPath });
      await jobContext.publishToErrorStream(dmErr);
      this.logger.error(`Error in SyncOperation ${syncOperation.ops[0].cmd === OPS_CMD.REMOVE_DIR ? 'Dir' : 'File'}: ${error.message}`);
    }
  }
  async safeUnlink(targetPath) {
    try {
      await fs.promises.unlink(targetPath);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
      this.logger.log(`File ${targetPath} does not exist, skipping unlink.`);
    }
  }
  validateSourceExist(sourcePath: string):boolean {
    if (!fs.existsSync(sourcePath)) {
    this.logger.error(`Source path does not exist: ${sourcePath}`);
    return false;
    }
    return true;
    }

  async isSMBHiddenFile(path: string): Promise<boolean> {
        const getIsHiddenCommand = CommandConfig.getSMBCommand(process.platform, CommandPattern.IS_SMB_HIDDEN_FILE)?.replaceAll('${PATH}', path);
        const output = await this.shellService.runCommand(getIsHiddenCommand);
        return output.trim().includes('Hidden');
    }

    async addHiddenAttribute(path: string): Promise<void> {
        const addHiddenCommand = CommandConfig.getSMBCommand(process.platform, CommandPattern.ADD_HIDDEN_ATTRIBUTE)?.replaceAll('${PATH}', path);
        await this.shellService.runCommand(addHiddenCommand);
    }

    async removeHiddenAttribute(path: string): Promise<void> {
        const removeHiddenCommand = CommandConfig.getSMBCommand(process.platform, CommandPattern.REMOVE_HIDDEN_ATTRIBUTE)?.replaceAll('${PATH}', path);
        await this.shellService.runCommand(removeHiddenCommand);
    }

    async stampHiddenAttribute({command, jobContext, sourcePath, targetPath, errorType}): Promise<any> {
        const output: any = { sourceErrors: [], targetErrors: [] };
        if (process.platform !== 'win32') return output;
        try {
            const hiddenAttribute = { isSourceHidden: false, isTargetHidden: false };
            if (!!command.ops[OPS_CMD.STAMP_META].params?.hiddenAttribute) {
                hiddenAttribute.isSourceHidden = command.ops[OPS_CMD.STAMP_META].params?.hiddenAttribute['isSourceHidden'] ?? false;
                hiddenAttribute.isTargetHidden = command.ops[OPS_CMD.STAMP_META].params?.hiddenAttribute['isTargetHidden'] ?? false;
            } else {
                const [isSourceHidden, isTargetHidden] = await Promise.all([this.isSMBHiddenFile(sourcePath), this.isSMBHiddenFile(targetPath)]);
                hiddenAttribute.isSourceHidden = isSourceHidden;
                hiddenAttribute.isTargetHidden = isTargetHidden;
            }
            if (hiddenAttribute.isSourceHidden !== hiddenAttribute.isTargetHidden) {
                if (hiddenAttribute.isSourceHidden) await this.addHiddenAttribute(targetPath);
                else await this.removeHiddenAttribute(targetPath);
            }
        } catch (error) {
            this.logger.error(`Error stamping hidden attribute for ${sourcePath}: ${error.message}`);
            // const dmErr = dmError("OPERATION", Origin.SOURCE, Operation.STAMP_META, errorType, command.id, error, { name: command.fPath, path: targetPath });
            // await jobContext.publishToErrorStream(dmErr);
            //output.sourceErrors.push(error.code);
        }
        return output;
    }
}

