import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { Command, OPS_STATUS, FileInfo, JobContext, CommandStatus, TaskStatus, MetaData } from '@netapp-cloud-datamigrate/jobs-lib';
import { RedisService } from 'src/redis/redis.service';

import { basePrefix, dmError, formatDate, getFileInfo } from '../utils/utils';
import { OPS_CMD, StampMetaDataOutput, SyncOperationInput, SyncOperationOutput, SyncTaskInput, SyncTaskOutput } from './migrate.type';
import { execSync } from 'child_process';

@Injectable()
export class MigrationSyncService {
  readonly workerId: string;
  readonly fetchTaskBatch: number;
  readonly pushTaskDirSize: number;
  readonly CHUNK_SIZE: number;
  
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    private readonly logger: Logger,
    private readonly redisService: RedisService,
  ) {
    this.workerId = this.configService.get('worker.workerId');
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

  async stampMetaData(filePath: string, metadata: MetaData, jobContext: JobContext, command: Command):Promise<StampMetaDataOutput> {
    const stampMetaDataOutput : StampMetaDataOutput = {errors: []}
    if(metadata?.mode) {
      try {
        fs.chmodSync(filePath, metadata.mode);
      } catch(error) {
        const dmErr = dmError("OPERATION", command.commandId, error, {name: command.fPath, path: filePath});
        await jobContext.appendToErrorList(dmErr);
        stampMetaDataOutput.errors.push(error.code)
        this.logger.error(`Error setting file mode: ${error.message}`);
      }
    }
    if(metadata?.birthtime){
      try {
        if(process.platform == 'win32') {
          const birthtime = new Date(metadata.birthtime).toISOString().replace(/T/, ' ').replace(/\..+/, '')
          const birthtimeCommand = `powershell.exe -Command "(Get-Item '${filePath}').CreationTime = '${birthtime}'"`;
          execSync(birthtimeCommand);
        }else {
          const birthtimeCommand = `touch -t ${formatDate(new Date(metadata.birthtime))} ${filePath}`;
          execSync(birthtimeCommand);
        }
      } catch(error) {
        this.logger.error(`Error setting file timestamps: ${error.message}`);
        const dmErr = dmError("OPERATION", command.commandId, error, {name: command.fPath, path: filePath});
        stampMetaDataOutput.errors.push(error.code)
        await jobContext.appendToErrorList(dmErr);
      }
    }
    if(metadata.mtime && metadata.atime) {
      try {
        fs.utimesSync(filePath, new Date(metadata.atime), new Date(metadata.mtime));
      } catch(error) {
        this.logger.error(`Error setting file timestamps: ${error.message}`);
        const dmErr = dmError("OPERATION", command.commandId, error, {name: command.fPath, path: filePath});
        stampMetaDataOutput.errors.push(error.code)
        await jobContext.appendToErrorList(dmErr);
      }
    }
    return stampMetaDataOutput
  }
  
  async syncOperation({ sourcePath, targetPath, ops, jobContext, command}: SyncOperationInput): Promise<SyncOperationOutput> {
    const syncOperation: SyncOperationOutput = {errors : new Set<string>(),  ops, status: OPS_STATUS.COMPLETED }
    if (syncOperation.ops[0].status === OPS_STATUS.READY) {
      if(syncOperation.ops[0].cmd === OPS_CMD.COPY_CONTENT) {
        try {
          this.logger.debug(`Copying file from ${sourcePath} to ${targetPath}`);
          const checksum = await this.copyFileWithChecksum(sourcePath, targetPath);
          syncOperation.checksums = checksum
          syncOperation.ops[0] = { ...ops[0], status: OPS_STATUS.COMPLETED, checksum } as any;
        } catch (error) {
          syncOperation.ops[0] = { ...ops[0], status: OPS_STATUS.ERROR, error: error.message } ;
          const dmErr = dmError("OPERATION", command.commandId, error, {name: command.fPath, path: targetPath});
          await jobContext.appendToErrorList(dmErr);
          syncOperation.errors.add(error.code)
          this.logger.error(`Error in SyncOperation File: ${error.message}`);
          return syncOperation
        }
      }
      if(ops[0].cmd === OPS_CMD.COPY_DIR) {
        try {
          this.logger.debug(`Copying DIR from ${sourcePath} to ${targetPath}`);
          await this.ensureDirectoryExists(targetPath);
          syncOperation.ops[0] = { ...ops[0], status: OPS_STATUS.COMPLETED };
        } catch (error) {
          ops[0] = { ...ops[0], status: OPS_STATUS.ERROR, error: error.message };
          const dmErr = dmError("OPERATION", command.commandId, error, {name: command.fPath, path: targetPath});
          await jobContext.appendToErrorList(dmErr);
          this.logger.error(`Error in SyncOperation Dir: ${error.message}`);
          return syncOperation
        }
      }
    }
    if (ops[1]?.status === OPS_STATUS.READY) {
      const result = await this.stampMetaData(targetPath, ops[1].metadata, jobContext, command)
      ops[1].status = OPS_STATUS.COMPLETED
      result.errors.forEach(error => syncOperation.errors.add(error))
    }
    return syncOperation ;
  }

  async syncTask({ task }: SyncTaskInput): Promise<SyncTaskOutput> {
    const syncTask: SyncTaskOutput = { errors: new Set<string>(), success: 0, error: 0 };
    const jobContext: JobContext = await this.redisService.getJobContext(task.jobRunId);
    task.status = TaskStatus.RUNNING
    task.commands.map((cmd: any) => cmd.status = OPS_STATUS.IN_PROCESS);
    let id = await jobContext.appendToUpdatedTaskList(task);
    jobContext.migrateTask.lastId = id;
    await this.redisService.setJobContext(task.jobRunId, jobContext);

    for (let i = 0;  i < task.commands.length; i++) {
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

    task.status = syncTask.error > 0 ? TaskStatus.ERRORED : TaskStatus.COMPLETED;
    if( syncTask.error > 0) {
        const dmErr = dmError("TASK", task.id,  undefined, undefined, {
            errorCode: syncTask.errors.size > 0 ? Array.from(syncTask.errors) : [], 
            message: `Task ${task.id} has ${syncTask.error} errors and ${syncTask.success} success during sync`
        });
        await jobContext.appendToErrorList(dmErr);
    }
    id = await jobContext.appendToUpdatedTaskList(task);
    jobContext.migrateTask.lastId = id;
    await this.redisService.setJobContext(task.jobRunId, jobContext);
    return syncTask;
  }
}
