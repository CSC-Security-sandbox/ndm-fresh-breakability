import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  OperationError,
  Task,
  TaskError,
  TaskStatus,
} from "@netapp-cloud-datamigrate/jobs-lib";
import { InventoryEntity } from "src/entities/inventory.entity";
import { OperationErrorEntity } from "src/entities/operation-error.entity";
import { OperationsEntity } from "src/entities/operation.entity";
import { TaskErrorEntity } from "src/entities/task-error.entity";
import { TaskEntity } from "src/entities/task.entity";
import { OperationStatus } from "src/enum/queues.enum";
import { Repository, UpdateResult } from "typeorm";
import { CreateInventory } from "./inventory.types";
import { randomUUID } from "crypto";

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @InjectRepository(InventoryEntity)
    private readonly inventoryRepo: Repository<InventoryEntity>,
    @InjectRepository(TaskEntity)
    private readonly taskRepo: Repository<TaskEntity>,

    @InjectRepository(OperationsEntity)
    private readonly operationRepo: Repository<OperationsEntity>,

    @InjectRepository(OperationErrorEntity)
    private readonly operationErrorRepo: Repository<OperationErrorEntity>,

        @InjectRepository(TaskErrorEntity)
        private readonly taskErrorRepo: Repository<TaskErrorEntity>
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
              const mappedData = batch.map(item => this.mapSourceToTarget(item, jobRunId, pathId));
              const inventoryRecords = this.inventoryRepo.create(mappedData);
              await this.inventoryRepo.save(inventoryRecords);
              this.logger.log(`Successfully inserted ${inventoryRecords.length} inventory records`);
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
      });

      await this.operationErrorRepo.save(operationError);
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
    try {
      if (!data || !data.jobRunId || !data.taskType || !data.status) {
        throw new Error("Invalid task data");
      }

      const {
        jobRunId,
        taskType,
        status,
        sPathId,
        tPathId,
        commands,
        workerId,
        id,
      } = data;

      if (!id) {
        this.logger.error("Task ID not found");
        return;
      }

      const taskId = id ?? randomUUID();
      console.log(taskId);

      // Create the task entity
      const task = this.taskRepo.create({
        id: taskId,
        jobRunId,
        status,
        taskType,
        workerId,
      });

      // Create operation entities in batches
      const batchSize = 100; // Adjust the batch size as needed
      const operationBatches: OperationsEntity[][] = [];

      if (commands && commands.length > 0) {
        for (let i = 0; i < commands.length; i += batchSize) {
          const batch: OperationsEntity[] = commands
            .slice(i, i + batchSize)
            .map((command: any) => {
              const operation = new OperationsEntity();
              operation.id = command.commandId;
              operation.taskId = taskId;
              operation.jobRunId = jobRunId;
              operation.sPathId = sPathId;
              operation.tPathId = tPathId?.length ? tPathId : null;
              operation.status = OperationStatus.IN_PROCESS;
              operation.operationType = taskType;
              operation.request = command;
              operation.fPath = command?.fPath;
              return operation;
            });
          operationBatches.push(batch);
        }
      }

      // Save the task and operation batches
      await this.taskRepo.save(task);

      if (operationBatches.length > 0) {
        for (const batch of operationBatches) {
          await this.operationRepo.save(batch);
        }
      }

      console.log(
        `Task and operations saved successfully for jobRunId: ${jobRunId}`
      );
    } catch (err) {
      this.logger.error(
        `Failed to save task records: ${err.message}`,
        err.stack
      );
      throw new Error("Error while saving task records to the database");
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
