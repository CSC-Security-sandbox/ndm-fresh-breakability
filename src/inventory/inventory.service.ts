import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { InjectRepository } from '@nestjs/typeorm';
import { OperationError, TaskError } from '@netapp-cloud-datamigrate/jobs-lib';
import { randomUUID } from 'crypto';
import { OperationErrorEntity } from 'src/entities/operation-error.entity';
import { OperationsEntity } from 'src/entities/operation.entity';
import { TaskErrorEntity } from 'src/entities/task-error.entity';
import { TaskEntity } from 'src/entities/task.entity';
import { OperationStatus, Pattern } from 'src/enum/queues.enum';
import { Repository, UpdateResult } from 'typeorm';
import { InventoryEntity } from '../entities/inventory.entity';
import { CreateInventory, DiscoveryCompletedPayload, InventoryPayload, InventoryPayloadType } from './inventory.type';

@Injectable()
export class InventoryService {

  // debugs
  private counter = 0;
  private totalObjects = 0;
  private completedCount = 0;

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
    private readonly taskErrorRepo: Repository<TaskErrorEntity>,

  ) {

  }

  async createInventory(data: CreateInventory[], jobRunId: string, pathId: string) {
    try {
      const mappedData = this.mapSourceToTarget(data[0], jobRunId, pathId);
      const inventoryRecords = this.inventoryRepo.create(mappedData);
      await this.inventoryRepo.insert(inventoryRecords);
    } catch (err) {
      this.logger.error(`Failed to save inventory records: ${err.message}`, err.stack);
      throw new Error('Error while saving inventory records to the database');
    }
  }
  mapSourceToTarget(file: any, jobRunId: string, pathId: string): any {
    return {
      path: file.path,
      isDirectory: file.isDirectory,
      sourceChecksum: "",
      targetChecksum: "",
      parentPath: file.parentPath,
      depth: file.depth,
      fileName: file.fileName,
      uid: file.uid.toString(),
      gid: file.gid.toString(),
      fileSize: BigInt(file.fileSize),
      extension: file.extension,
      fileType: file.fileType as any,
      modifiedTime: file.modifiedTime,
      accessTime: file.accessTime,
      permission: file.permission,
      jobRunId: jobRunId,
      birthTime: file.birthTime,
      pathId: pathId,
    };
  }



  async saveTasks(data: any) {
    try {
      const { jobRunId, taskType, status, sPathId, tPathId, commands, workerId, id } = data;
      const taskId = id ?? randomUUID();
      const task: TaskEntity = this.taskRepo.create({
        id: taskId,
        jobRunId,
        status,
        taskType,
        workerId
      });
      await this.taskRepo.save(task);
      const operations: OperationsEntity[] = commands.map((command: any) => this.operationRepo.create({
        id: command.commandId,
        taskId: task.id,
        jobRunId,
        sPathId: sPathId,
        tPathId: tPathId ? (tPathId.length > 0 ? tPathId : null) : null,
        status: OperationStatus.IN_PROCESS,
        operationType: taskType,
        request: command,
        fPath: command?.fPath
      }))
      if (operations.length > 0) await this.operationRepo.save(operations);
    } catch (err) {
      this.logger.error(`Failed to save task records: ${err.message}`, err.stack);
      throw new Error('Error while saving task records to the database');
    }
  }
  async saveOperationError(data: OperationError) {
    try {
      const { operationId, errorCode, errorMessage, errorFiles } = data;
      const operationError: OperationErrorEntity = this.operationErrorRepo.create({
        errorCode: errorCode,
        errorMessage: errorMessage,
        operationId,
        fileName: errorFiles.fileName,
        filePath: errorFiles.filePath,
        createdAt: new Date()
      });
      await this.operationErrorRepo.save(operationError);
    } catch (err) {
      this.logger.error(`Failed to save operation error records: ${err.message}`, err.stack);
      throw new Error('Error while saving operation error records to the database');
    }
  }
  async saveTaskError(data: TaskError) {
    try {
      const { taskId, errorCode, errorMessage } = data;
      const taskError: TaskErrorEntity = this.taskErrorRepo.create({
        errorCode: errorCode,
        errorMessage: errorMessage,
        taskId,
        createdAt: new Date()
      });
      await this.taskErrorRepo.save(taskError);
    } catch (err) {
      throw new Error('Error while saving task error records to the database');
    }
  }

  async updateTask(taskId: string, data: Partial<TaskEntity>): Promise<UpdateResult> {
    try {
      return await this.taskRepo.update({ id: taskId }, data);
    } catch (error) {
      this.logger.log('Something went wrong while updating task data -> ', error);
      throw error;
    }
  }

  async updateOperation(operationId: string, data: Partial<OperationsEntity>): Promise<UpdateResult> {
    try {
      return await this.operationRepo.update({ id: operationId }, data);
    } catch (error) {
      this.logger.log('Something went wrong while updating operation data -> ', error);
      throw error;
    }
  }
}
