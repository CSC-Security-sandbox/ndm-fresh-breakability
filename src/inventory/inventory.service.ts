import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  OperationError,
  Task,
  TaskError,
  TaskStatus,
} from "@netapp-cloud-datamigrate/jobs-lib";
import { InventoryEntity } from "../entities/inventory.entity";
import { OperationErrorEntity } from "../entities/operation-error.entity";
import { OperationsEntity } from "../entities/operation.entity";
import { TaskErrorEntity } from "../entities/task-error.entity";
import { TaskEntity } from "../entities/task.entity";
import { OperationStatus } from "../enum/queues.enum";
import { DataSource, Repository, UpdateResult } from "typeorm";
import { CreateInventory } from "./inventory.types";
import { randomUUID } from "crypto";
import { SpeedLogEntity, SpeedLogEntryEntity } from '../entities/speed-test.entity';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(InventoryEntity)
    private readonly inventoryRepo: Repository<InventoryEntity>,
    @InjectRepository(TaskEntity)
    private readonly taskRepo: Repository<TaskEntity>,

    @InjectRepository(OperationsEntity)
    private readonly operationRepo: Repository<OperationsEntity>,

    @InjectRepository(OperationErrorEntity)
    private readonly operationErrorRepo: Repository<OperationErrorEntity>,

    @InjectRepository(TaskErrorEntity)
    private readonly taskErrorRepo: Repository<TaskErrorEntity>,

    @InjectRepository(SpeedLogEntity)
    private speedLogRepo: Repository<SpeedLogEntity>,

    @InjectRepository(SpeedLogEntryEntity)
    private SpeedLogEntryRepo: Repository<SpeedLogEntryEntity>,
  ) {

  }
  mapSourceToTarget(file: any, jobRunId: string, pathId: string): any {
    if (!file) {
      throw new Error('Invalid file object: Cannot map undefined or null file');
    }
    return {
      path: file.path ?? '',
      isDirectory: file.isDirectory ?? false,
      sourceChecksum: file?.sourceChecksum ?? null,
      targetChecksum: file?.targetChecksum ?? null,
      parentPath: file?.parentPath ?? '',
      depth: file?.depth ?? 0,
      fileName: file?.fileName ?? '',
      uid: file?.uid ? file.uid.toString() : '',
      gid: file?.gid ? file.gid.toString() : '',
      fileSize: file?.fileSize ? BigInt(file.fileSize).toString() : '0',
      extension: file?.extension ?? '',
      fileType: file?.fileType ?? null,
      modifiedTime: file?.modifiedTime ?? null,
      accessTime: file?.accessTime ?? null,
      permission: file?.permission ?? '',
      jobRunId: jobRunId,
      birthTime: file?.birthTime ?? null,
      pathId: pathId,
    };
  }

  async saveSpeedLogsEntries(data: any) {
    try {
      // Create and save the new record
      const writeLogEntry = this.SpeedLogEntryRepo.create({
        speedLogId: data.testType,
        timeStamp: data.timeStamp,
        speed: Number(data.speed),
      });
      await this.SpeedLogEntryRepo.save(writeLogEntry);
    } catch (err) {
      this.logger.error('Error while saving Speed Log records to the database:', err);
      throw new Error('Error while saving Speed Log records to the database');
    }
  }


  async createInventory(data: CreateInventory[], jobRunId: string, pathId: string) {
    if (!data || data.length === 0) {
      this.logger.warn('No inventory data received, skipping insert.');
      return;
    }

    const batchSize = 500; // Adjust batch size as needed
    const failedRecords: CreateInventory[] = [];

    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      try {
        const mappedData = Object.values(
          batch
            .map(item => this.mapSourceToTarget(item, jobRunId, pathId))
            .reduce((acc, curr) => {
              const key = `${curr.path}|${curr.jobRunId}|${curr.isDirectory}`;
              acc[key] = curr;
              return acc;
            }, {} as Record<string, any>)
        );
        
        const inventoryRecords = await this.inventoryRepo.upsert(mappedData, ['path', 'jobRunId', 'isDirectory']);
        this.logger.log(`Successfully inserted ${inventoryRecords.raw} inventory records`);
      } catch (err) {
        this.logger.error(`Failed to save inventory records in batch: ${err.message}`, err.stack);
        failedRecords.push(...batch);
      }
    }

    if (failedRecords.length > 0) {
      this.logger.error(`Total failed records: ${failedRecords.length}. Logging them separately.`);
      failedRecords.forEach(record => this.logger.error(`Failed Record: ${JSON.stringify(record)}`));
    }
  }

  async saveOperationError(data: OperationError) {
    try {
      if (!data || !data.operationId) {
        throw new Error('Invalid operation error data');
      }

      const operationError = this.operationErrorRepo.create({
        errorCode: data.errorCode,
        errorMessage: data.errorMessage,
        operationId: data.operationId,
        fileName: data.errorFiles?.fileName ?? null,
        filePath: data.errorFiles?.filePath ?? null,
        createdAt: new Date(),
        error_type: data?.errorType || null
      });

      await this.operationErrorRepo.save(operationError);
      this.logger.log(`Successfully saved operation operationError record`);
    } catch (err) {
      this.logger.error(
        `Failed to save operation error records: ${err.message}`,
        err.stack
      );
      throw new Error(
        "Error while saving operation error records to the database"
      );
    }
  }
  async saveTaskError(data: TaskError) {
    try {
      if (!data || !data.taskId) {
        throw new Error("Invalid task error data");
      }

      const taskError = this.taskErrorRepo.create({
        errorCode: data.errorCode,
        errorMessage: data.errorMessage,
        taskId: data.taskId,
        createdAt: new Date(),
        error_type: data?.errorType || null
      });

      await this.taskErrorRepo.save(taskError);
    } catch (err) {
      this.logger.error(
        `Failed to save task error records: ${err.message}`,
        err.stack
      );
      throw new Error("Error while saving task error records to the database");
    }
  }


  async saveTasks(data: any) {
    if (!data || !data.jobRunId || !data.taskType || !data.status) {

      throw new Error("Invalid task data");
    }
    try {
     
      const { jobRunId, taskType, status, sPathId, tPathId, commands, workerId, id } = data;
      const taskId = id
      if (!taskId) {
        this.logger.error("Task ID not found");
        return;
      }
      const queryRunner = this.dataSource.createQueryRunner(); // Create query runner

      await queryRunner.connect();
      await queryRunner.startTransaction();
      try {
        const task = await queryRunner.manager.findOne(TaskEntity, {
          where: { id },
          lock: { mode: "pessimistic_write" }, // Lock for concurrency
        });
  
        if (!task || task.status !== 'COMPLETED') {
          await queryRunner.manager.upsert(
            TaskEntity,
            { id, jobRunId, status, taskType, workerId },
            ['id']
          );
        }
  
        await queryRunner.commitTransaction();
      } catch (error) {
        await queryRunner.rollbackTransaction(); 
        this.logger.error("Failed to save task records:", error);
      } finally {
        await queryRunner.release(); 
      }
    

      const batchSize = 100;
      const operationBatches: OperationsEntity[][] = [];

      if (Array.isArray(commands) && commands.length > 0) {
        for (let i = 0; i < commands.length; i += batchSize) {
          const batch = commands.slice(i, i + batchSize).map((command: any) => ({
            id: command.commandId,
            taskId,
            jobRunId,
            sPathId,
            tPathId: tPathId?.length ? tPathId : null,
            status: OperationStatus.IN_PROCESS,
            operationType: taskType,
            request: command,
            fPath: command?.fPath,
          })) as OperationsEntity[];

          operationBatches.push(batch);
        }
      }

      // Save the task
      // Save all operation batches concurrently
      if (operationBatches.length > 0) {
        await Promise.all(operationBatches.map(batch => this.operationRepo.upsert(batch,["id"])));
      }
      this.logger.log(`✅ Task and operations saved successfully for jobRunId: ${jobRunId}`);
    } catch (err) {
      this.logger.error(`❌ Failed to save task records: ${err.message}`, err.stack);
    }
  }


  async updateTask(
    taskId: string,
    data: Partial<TaskEntity>
  ): Promise<UpdateResult> {
    try {
      if (!taskId || !Object.keys(data).length) {
        throw new Error("Invalid input: taskId and update data are required");
      }

      const result = await this.taskRepo.update(taskId, data);

      if (result.affected === 0) {
        this.logger.error(`No task found with id: ${taskId}`);
      }

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to update task (ID: ${taskId}): ${error.message}`,
        error.stack
      );
      throw new Error("Error while updating task data");
    }
  }
}
