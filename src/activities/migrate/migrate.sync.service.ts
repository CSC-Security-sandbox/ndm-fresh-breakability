import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Command, OPS_STATUS, FileInfo, JobContext, CommandStatus, TaskStatus, MetaData, ErrorType } from '@netapp-cloud-datamigrate/jobs-lib';
import { RedisService } from 'src/redis/redis.service';
import { basePrefix, dmError, formatDate, getFileInfo, isFatalError } from '../utils/utils';
import { OPS_CMD, StampMetaDataOutput, SyncOperationInput, SyncOperationOutput, SyncTaskInput, SyncTaskOutput } from './migrate.type';
import { execSync } from 'child_process';
import { Operation, Origin } from '../utils/utils.types';

@Injectable()
export class MigrationSyncService {
  readonly workerId: string;
  readonly fetchTaskBatch: number;
  readonly pushTaskDirSize: number;
  readonly CHUNK_SIZE: number;
  readonly maxRetryCount: number = 3;
  
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    private readonly logger: Logger,
    private readonly redisService: RedisService,
  ) {
    this.workerId = this.configService.get('worker.workerId');
    this.maxRetryCount = this.configService.get('worker.maxRetryCount') || 3;
    this.fetchTaskBatch = 50;
    this.pushTaskDirSize = 500;
    this.CHUNK_SIZE = 1024 * 1024;
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
  
  async stampMetaData(targetPath: string, sourcePath: string,  metadata: MetaData, jobContext: JobContext, command: Command):Promise<StampMetaDataOutput> {
    const stampMetaDataOutput : StampMetaDataOutput = {errors: [], errorType : command.retryCount >= this.maxRetryCount ? ErrorType.TRANSIENT_ERROR : ErrorType.RECOVERABLE_ERROR}
    if(metadata?.mode) {
      try {
        fs.chmodSync(targetPath, metadata.mode);
      } catch(error) {
        const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META,stampMetaDataOutput.errorType, command.commandId, error, {name: command.fPath, path: targetPath});
        await jobContext.appendToErrorList(dmErr);
        stampMetaDataOutput.errors.push(error.code)
        this.logger.error(`Error setting file mode: ${error.message}`);
      }
    }
    if(metadata?.birthtime){
      try {
        if(process.platform == 'win32') {
          const birthtime = new Date(metadata.birthtime).toISOString().replace(/T/, ' ').replace(/\..+/, '')
          const birthtimeCommand = `powershell.exe -Command "(Get-Item '${targetPath}').CreationTime = '${birthtime}'"`;
          execSync(birthtimeCommand);
        }else {
          const birthtimeCommand = `touch -t ${formatDate(new Date(metadata.birthtime))} ${targetPath}`;
          execSync(birthtimeCommand);
        }
      } catch(error) {
        this.logger.error(`Error setting file timestamps: ${error.message}`);
        const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, stampMetaDataOutput.errorType, command.commandId, error, {name: command.fPath, path: targetPath});
        stampMetaDataOutput.errors.push(error.code)
        await jobContext.appendToErrorList(dmErr);
      }
    }
    if(jobContext.jobConfig.options.isIdentityMappingAvailable) {
      if(metadata.gid && metadata.uid && process.platform !== 'win32') {
          try {
            const gid = await this.redisService.getOwnerIdentity(jobContext, metadata.gid?.toString(), 'GID')
            const uid = await this.redisService.getOwnerIdentity(jobContext, metadata.uid?.toString(), 'UID')
            this.logger.debug(`UID : ${metadata.uid} -> ${uid}`)
            this.logger.debug(`GID : ${metadata.gid} -> ${gid}`)
            if(gid && uid)
              fs.chownSync(targetPath, parseInt(uid), parseInt(gid));
          } catch(error) {
            this.logger.error(`Error setting ownership: ${error.message}`);
            const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, stampMetaDataOutput.errorType, command.commandId, error, {name: command.fPath, path: targetPath});
            stampMetaDataOutput.errors.push(error.code)
            await jobContext.appendToErrorList(dmErr);
          }
        }
       if(process.platform === 'win32') {
          try{
            const getSIDCommand= `powershell.exe -Command "(Get-Acl '${sourcePath}').Owner"`;
            metadata.sid = execSync(getSIDCommand, { encoding: "utf-8" }).trim();
          }
          catch(error) {
            this.logger.error(`Error setting ownership: ${error.message}`);
            const dmErr = dmError("OPERATION", Origin.SOURCE, Operation.STAMP_META, stampMetaDataOutput.errorType, command.commandId, error, {name: command.fPath, path: targetPath});
            stampMetaDataOutput.errors.push(error.code)
            await jobContext.appendToErrorList(dmErr);
          }
       }
       try{
          const sid = await this.redisService.getOwnerIdentity(jobContext, metadata.sid, 'SID')
          if(sid) {
            const command = `powershell -Command "$acl = Get-Acl '${targetPath}'; $acl.SetOwner([System.Security.Principal.NTAccount]'${sid}'); Set-Acl '${targetPath}' $acl"`;
            execSync(command);
          } else {
            this.logger.debug(`SID not found for the file ${sourcePath}`)
          }
        } catch(error) {
          this.logger.error(`Error setting ownership: ${error.message}`);
          const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, stampMetaDataOutput.errorType, command.commandId, error, {name: command.fPath, path: targetPath});
          stampMetaDataOutput.errors.push(error.code)
          await jobContext.appendToErrorList(dmErr);
      }
    }
    
    if(metadata.mtime && metadata.atime) {
      try {
        fs.utimesSync(targetPath, new Date(metadata.atime), new Date(metadata.mtime));
      } catch(error) {
        this.logger.error(`Error setting file timestamps: ${error.message}`);
        const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_TIME, stampMetaDataOutput.errorType, command.commandId, error, {name: command.fPath, path: targetPath});
        stampMetaDataOutput.errors.push(error.code)
        await jobContext.appendToErrorList(dmErr);
      }
    }

    if(metadata.mtime && metadata.atime && jobContext.jobConfig.options.preserveAccessTime) {
      try {
        fs.utimesSync(sourcePath, new Date(metadata.atime), new Date(metadata.mtime));
      } catch(error) {
        this.logger.error(`Error preserving file timestamps: ${error.message}`);
        const dmErr = dmError("OPERATION", Origin.SOURCE, Operation.STAMP_TIME, stampMetaDataOutput.errorType, command.commandId, error, {name: command.fPath, path: targetPath});
        stampMetaDataOutput.errors.push(error.code)
        await jobContext.appendToErrorList(dmErr);
      }
    }
    return stampMetaDataOutput
  }
  
  async syncOperation({ sourcePath, targetPath, ops, jobContext, command }: SyncOperationInput): Promise<SyncOperationOutput> {
    const syncOperation: SyncOperationOutput = {errors : new Set<string>(),  ops, status: OPS_STATUS.COMPLETED , errorType : command.retryCount >= this.maxRetryCount ? ErrorType.TRANSIENT_ERROR : ErrorType.RECOVERABLE_ERROR }
    if (syncOperation.ops[0] && syncOperation.ops[0].status !== OPS_STATUS.COMPLETED) {
      if(syncOperation.ops[0].cmd === OPS_CMD.COPY_CONTENT) {
        try {
          this.logger.debug(`Copying file from ${sourcePath} to ${targetPath}`);
          const checksum = await this.copyFileWithChecksum(sourcePath, targetPath);
          syncOperation.checksums = checksum
          syncOperation.ops[0] = { ...ops[0], status: OPS_STATUS.COMPLETED, checksum } as any;
        } catch (error) {
          syncOperation.ops[0] = { ...ops[0], status: OPS_STATUS.ERROR, error: error.message } ;
          const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.COPY_CONTENT, syncOperation.errorType, command.commandId, error, {name: command.fPath, path: targetPath});
          await jobContext.appendToErrorList(dmErr);
          syncOperation.errors.add(error.code)
          this.logger.error(`Error in SyncOperation File: ${error.message}`);
          return syncOperation
        }
      }
      if(syncOperation.ops[0].cmd === OPS_CMD.COPY_DIR) {
        try {
          this.logger.debug(`Copying DIR from ${sourcePath} to ${targetPath}`);
          await this.ensureDirectoryExists(targetPath);
          syncOperation.ops[0] = { ...ops[0], status: OPS_STATUS.COMPLETED };
        } catch (error) {
          syncOperation.ops[0] = { ...ops[0], status: OPS_STATUS.ERROR, error: error.message };
          const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.COPY_CONTENT, syncOperation.errorType, command.commandId, error, {name: command.fPath, path: targetPath});
          await jobContext.appendToErrorList(dmErr);
          this.logger.error(`Error in SyncOperation Dir: ${error.message}`);
          return syncOperation
        }
      }
    }
    if (syncOperation.ops[1]?.status !== OPS_STATUS.COMPLETED && ops[0].cmd !== OPS_CMD.COPY_DIR) {
      this.logger.debug(`Meta Data Updating from ${sourcePath} to ${targetPath} : ${JSON.stringify(ops[1])}`);
      const result = await this.stampMetaData(targetPath, sourcePath, ops[1].metadata, jobContext, command)
      result.errors.forEach(error => syncOperation.errors.add(error))
      syncOperation.ops[1].status = result.errors.length > 0 ? OPS_STATUS.ERROR : OPS_STATUS.COMPLETED
    }
    return syncOperation ;
  }

  async syncTask({ task }: SyncTaskInput): Promise<SyncTaskOutput> {
    const syncTask: SyncTaskOutput = { errors: new Set<string>(), success: 0, error: 0, retryCount : 0, isFatal: false };
    const jobContext: JobContext = await this.redisService.getJobContext(task.jobRunId);
    task.status = TaskStatus.RUNNING
    for (let i = 0;  i < task.commands.length; i++) 
      if(task.commands[i].status !== CommandStatus.COMPLETED)
        task.commands[i].status = CommandStatus.IN_PROCESS

    jobContext.migrateTask.lastId = await jobContext.appendToUpdatedTaskList(task);
    await this.redisService.setJobContext(task.jobRunId, jobContext);

    for (let i = 0;  i < task.commands.length; i++) {
      if(task.commands[i].status === CommandStatus.COMPLETED) continue;
      const baseSourcePrefixPath = basePrefix(task.jobRunId, task.sPathId);
      const baseTargetPrefixPath = basePrefix(task.jobRunId, task.tPathId);
      const scanInput: SyncOperationInput = {
        sourcePath: `${baseSourcePrefixPath}${task.commands[i].fPath}`,
        targetPath: `${baseTargetPrefixPath}${task.commands[i].fPath}`,
        ops: task.commands[i].ops,
        command: task.commands[i],
        jobContext
      };
      const syncOperationOp: SyncOperationOutput = await this.syncOperation(scanInput);
      task.commands[i].ops = syncOperationOp.ops;
      if (syncOperationOp.errors.size > 0) {
        task.commands[i].retryCount++;
        syncTask.retryCount = Math.max(task.commands[i].retryCount,  syncTask.retryCount)
        task.commands[i].status = CommandStatus.ERROR;
        syncOperationOp.errors.forEach(error => syncTask.errors.add(error));
        syncTask.error++;
      }
      else {
        const fileInfo: FileInfo = await getFileInfo(task.commands[i].fPath, `${task.sPath}${task.commands[i].fPath}`, task.commands[i].fPath, syncOperationOp.checksums);
        const id = await jobContext.appendToFileList(fileInfo);
        jobContext.filesInfo.lastId = id;
        jobContext.filesInfo.numMessages++;
        task.commands[i].status = CommandStatus.COMPLETED
        syncTask.success++;
        await this.redisService.setJobContext(task.jobRunId, jobContext);
        this.logger.debug(`Migrated ${task.commands[i].fPath} successfully`);
      }
    }

    this.logger.error(`syncTask.retryCount  : ${syncTask.retryCount }`)

    if(syncTask.error > 0 && syncTask.retryCount >= this.maxRetryCount)  
      task.status = TaskStatus.ERRORED 
    else if( syncTask.retryCount > 0) 
      task.status = TaskStatus.COMPLETED_WITH_ERROR 
    else 
      task.status = TaskStatus.COMPLETED
     
    if( syncTask.error > 0) {
      for(const error of syncTask.errors)
        if(isFatalError(error)) {
          syncTask.isFatal = true;
          break;
        }

      const errorType = syncTask.isFatal ? ErrorType.FATAL_ERROR : syncTask.retryCount >= this.maxRetryCount ? ErrorType.TRANSIENT_ERROR : ErrorType.RECOVERABLE_ERROR;
      const dmErr = dmError("TASK", Origin.DESTINATION,  Operation.COPY_CONTENT, errorType, task.id,  undefined, undefined, {
          errorCode: syncTask.errors.size > 0 ? Array.from(syncTask.errors) : [], 
          message: `Task ${task.id} has ${syncTask.error} errors and ${syncTask.success} success during sync`
      });
      jobContext.errorsInfo.lastId = await jobContext.appendToErrorList(dmErr);
      if(syncTask.retryCount < this.maxRetryCount) {
        this.logger.debug(`Appending to Retry => ${JSON.stringify(task)}`)
        jobContext.migrateTask.lastId = await jobContext.appendToMigrationTask(task);
      }
    }else {
      jobContext.updatedTaskInfo.lastId= await jobContext.appendToUpdatedTaskList(task);
    }
    await this.redisService.setJobContext(task.jobRunId, jobContext);
    return syncTask;
  }
}
