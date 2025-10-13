import { Injectable, Inject, Optional, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  ItemInfo,
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
import {
  LoggerService,
  LoggerFactory,
} from '@netapp-cloud-datamigrate/logger-lib';
import { DatabaseError, ValidationError } from '../errors/custom-errors';

@Injectable()
export class InventoryService {
  private readonly logger: LoggerService;

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

    @Optional() @Inject(LoggerFactory) loggerFactory?: LoggerFactory,
  ) {
    if (loggerFactory) {
      this.logger = loggerFactory.create(InventoryService.name);
    } else {
      // Fallback to basic NestJS Logger for worker threads
      this.logger = new Logger(InventoryService.name) as any;
    }
  }
  mapSourceToTarget(file: ItemInfo, jobRunId: string, pathId: string): any {
    if (!file) {
      throw new ValidationError('Invalid file object: Cannot map undefined or null file', 'file');
    }
    return {
      path: file.fileName ?? '', 
      isDirectory: file.isDirectory ?? false,
      sourceChecksum: file?.sourceMeta?.checksum ?? null,
      targetChecksum: file?.targetMeta?.checksum ?? null,
      parentPath: file?.fileName ?? '', // TODO - deprecate
      depth: file?.depth ?? 0,
      fileName: file?.fileName ?? '', // TO-DO deprecate
      uid: file?.targetMeta?.uid?.toString() ?? file?.sourceMeta?.uid?.toString() ?? '',
      gid: file?.targetMeta?.gid?.toString() ?? file?.sourceMeta?.gid?.toString() ?? '',
      fileSize: file?.size ? BigInt(file.size).toString() : '0',
      extension: file?.extension ?? '',
      fileType: file?.fileType ?? null,
      modifiedTime: file?.targetMeta?.modifiedTime ?? file?.sourceMeta?.modifiedTime ?? null,
      accessTime: file?.targetMeta?.accessTime ?? file?.sourceMeta?.accessTime ?? null,
      permission: file?.targetMeta?.permission ?? file?.sourceMeta?.permission ?? null,
      jobRunId: jobRunId,
      birthTime: file?.targetMeta?.birthTime ?? file?.sourceMeta?.birthTime ?? null,
      pathId: pathId,
      sourceMeta: file?.sourceMeta ?? null,
      targetMeta: file?.targetMeta ?? null,
      inode: file?.inode ?? null,
    };
  }

  async saveSpeedLogsEntries(data: any) {
    try {
      const writeLogEntry = this.SpeedLogEntryRepo.create({
        speedLogId: data.testType,
        timeStamp: data.timeStamp,
        speed: Number(data.speed),
      });
      await this.SpeedLogEntryRepo.save(writeLogEntry);
    } catch (err) {
      this.logger.error('Error saving Speed Log records:', err?.stack || err);
      throw new DatabaseError('Error while saving Speed Log records to the database', err);
    }
  }


  async createInventory(data: ItemInfo[], jobRunId: string, pathId: string) {
    if (!data || data.length === 0) {
      return;
    }

    const batchSize = 500; // Adjust batch size as needed
    const failedRecords: ItemInfo[] = [];

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
        
        await this.inventoryRepo.upsert(mappedData, ['path', 'jobRunId', 'isDirectory']);
      } catch (err) {
        this.logger.error(`Failed to save inventory batch: ${err.message}`, err?.stack || err);
        failedRecords.push(...batch);
      }
    }

    if (failedRecords.length > 0) {
      this.logger.error(`Failed to save ${failedRecords.length} inventory records`);
    }
  }

  async saveOperationError(data: OperationError) {
    try {
      if (!data || !data.operationId) {
        throw new ValidationError('Invalid operation error data', 'data');
      }

      const operationError = this.operationErrorRepo.create({
        errorCode: data.errorCode,
        errorMessage: data.errorMessage,
        operationId: data.operationId,
        fileName: data.errorFiles?.fileName ?? null,
        filePath: data.errorFiles?.filePath ?? null,
        createdAt: new Date(),
        error_type: data?.errorType || null,
        operationType:data?.operationName || null,
        origin: data?.origin || null,
      });

      await this.operationErrorRepo.save(operationError);
    } catch (err) {
      this.logger.error(`Failed to save operation error: ${err.message}`, err?.stack || err);
      throw new DatabaseError("Error while saving operation error records to the database", err);
    }
  }
  async saveTaskError(data: TaskError) {
    try {
      if (!data || !data.taskId) {
        throw new ValidationError("Invalid task error data", 'data');
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
      this.logger.error(`Failed to save task error: ${err.message}`, err?.stack || err);
      throw new DatabaseError("Error while saving task error records to the database", err);
    }
  }


  async saveTasks(data: any) {
    if (!data || !data.jobRunId || !data.taskType || !data.status) {
      throw new ValidationError("Invalid task data", 'data');
    }
    
    try {
      const { jobRunId, taskType, status, sPathId, tPathId, commands, workerId, id } = data;
      const taskId = id;
      
      if (!taskId) {
        this.logger.error("Task ID not found");
        return;
      }
      
      const queryRunner = this.dataSource.createQueryRunner();

      await queryRunner.connect();
      await queryRunner.startTransaction();
      try {
        const task = await queryRunner.manager.findOne(TaskEntity, {
          where: { id },
          lock: { mode: "pessimistic_write" },
        });
  
        if (!task || ![TaskStatus.COMPLETED, TaskStatus.COMPLETED_WITH_ERROR, TaskStatus.ERRORED].includes(task?.status)) {
          const updatedAt = [TaskStatus.COMPLETED, TaskStatus.COMPLETED_WITH_ERROR, TaskStatus.ERRORED].includes(status)
          ? new Date()
          : null;
          await queryRunner.manager.upsert(
            TaskEntity,
            { id, jobRunId, status, taskType, workerId ,updatedAt},
            ['id']
          );
        }
  
        await queryRunner.commitTransaction();
      } catch (error) {
        await queryRunner.rollbackTransaction(); 
        this.logger.error("Failed to save task:", error?.stack || error);
      } finally {
        await queryRunner.release(); 
      }

      const batchSize = 100;
      const operationBatches: OperationsEntity[][] = [];

      if (Array.isArray(commands) && commands.length > 0) {
        for (let i = 0; i < commands.length; i += batchSize) {
          const batch = commands.slice(i, i + batchSize).map((command: any) => ({
            id: command.id,
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

      if (operationBatches.length > 0) {
        await Promise.all(operationBatches.map(batch => this.operationRepo.upsert(batch,["id"])));
      }
    } catch (err) {
      this.logger.error(`Failed to save task records: ${err.message}`, err?.stack || err);
    }
  }


  async updateTask(
    taskId: string,
    data: Partial<TaskEntity>
  ): Promise<UpdateResult> {
    try {
      if (!taskId || !Object.keys(data).length) {
        throw new ValidationError("Invalid input: taskId and update data are required", 'taskId');
      }

      const result = await this.taskRepo.update(taskId, data);

      if (result.affected === 0) {
        this.logger.error(`No task found with id: ${taskId}`);
      }

      return result;
    } catch (error) {
      this.logger.error(`Failed to update task (ID: ${taskId}): ${error.message}`, error?.stack || error);
      throw new DatabaseError("Error while updating task data", error);
    }
  }

  async createPartitionInventoryTableByJobRunId(jobRunId: string) {
    if (!jobRunId) {
      throw new ValidationError("JobRunId is required to create partition table", 'jobRunId');
    }
    try {
      await this.dataSource.query(
        `CALL ${process.env.SCHEMA}.create_inventory_partition($1, $2);`,
        [jobRunId, process.env.SCHEMA],
      );
      this.logger.log(`Partition table  created or already exists for job run ID: ${jobRunId}`);
    } catch (error) {
      this.logger.error(`Failed to create partition table for jobRunId ${jobRunId}: ${error.message}`, error?.stack || error);
      throw new DatabaseError("Error while creating partition inventory table", error);
    }
  }
}
