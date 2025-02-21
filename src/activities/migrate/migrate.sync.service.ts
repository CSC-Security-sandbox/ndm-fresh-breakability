import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from "fs"; 
import * as path from "path";
import * as crypto from "crypto";
import { Logger } from "src/logger/logger.service";
import { RedisService } from 'src/redis/redis.service';
import { OperationStatus } from '../discovery/enums';
import { SyncOperationInput, SyncOperationOutput, SyncTaskInput, SyncTaskOutput } from './migrate.type';

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

  async copyFileWithChecksum(sourceFile: string, destinationFile: string): Promise<string> {
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
  
    const checksum = hash.digest("hex");
    const targetChecksum = await this.calculateChecksum(destinationFile);
  
    if (checksum !== targetChecksum) {
      throw new Error(`Checksum mismatch for file ${destinationFile}. Checksum: ${checksum} != ${targetChecksum}`);
    }
  
    return checksum;
  }
  

  async syncOperation({ sourcePath, targetPath, ops }: SyncOperationInput): Promise<SyncOperationOutput> {
    if (ops[0].status === OperationStatus.READY) {
      try {
        const checksum = await this.copyFileWithChecksum(sourcePath, targetPath);
        ops[0] = { ...ops[0], status: OperationStatus.COMPLETED, checksum } as any;
      } catch (error) {
        ops[0] = { ...ops[0], status: OperationStatus.ERROR, error: error.message }as any;
        this.logger.error(`Error in SyncOperation: ${error.message}`);
        return { ops, Status: OperationStatus.ERROR };
      }
    }

    if (ops[1]?.status === OperationStatus.READY) {
      this.logger.log('Stamping meta data');
    }

    return { ops, Status: OperationStatus.COMPLETED };
  }

  async syncTask({ task }: SyncTaskInput): Promise<SyncTaskOutput> {
    let isError = false;
    // const jobContext = await this.redisService.getJobContext(task.jobRunId);

    for (const command of task.commands) {
      const scanInput: SyncOperationInput = {
        sourcePath: `${task.sPath}${command.fPath}`,
        targetPath: `${task.tPath}${command.fPath}`,
        ops: command.ops
      };

      const syncOperationOp: SyncOperationOutput = await this.syncOperation(scanInput);
      
      if (syncOperationOp.Status === OperationStatus.ERROR) {
        isError = true;
        task.status = 'COMPLETED-WITH-ERROR';
      } else {
        this.logger.debug(`Migrated ${command.fPath} successfully`);
      }
    }

    // Updating job context
    // jobContext.appendToUpdatedTaskList(task);
    // await this.redisService.setJobContext(task.jobRunId, jobContext);

    return { status: isError ? 'ERROR' : 'COMPLETE' };
  }
}
