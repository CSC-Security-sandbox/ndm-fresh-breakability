import { Injectable, Inject, Optional, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  ItemInfo,
  OperationError,
  TaskError,
  TaskStatus,
  CommandStatus,
} from "@netapp-cloud-datamigrate/jobs-lib";
import { InventoryEntity } from "../entities/inventory.entity";
import { OperationErrorEntity } from "../entities/operation-error.entity";
import { OperationsEntity } from "../entities/operation.entity";
import { TaskErrorEntity } from "../entities/task-error.entity";
import { TaskEntity } from "../entities/task.entity";
import { OperationStatus, OperationType } from "../enum/queues.enum";
import { DataSource, Repository, UpdateResult } from "typeorm";
import { SpeedLogEntity, SpeedLogEntryEntity } from '../entities/speed-test.entity';
import {
  LoggerService,
  LoggerFactory,
} from '@netapp-cloud-datamigrate/logger-lib';
import { DatabaseError, ValidationError } from '../errors/custom-errors';
import * as path from 'path';

@Injectable()
export class InventoryService {
  private static readonly DEFAULT_SCHEMA = 'datamigrator';
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

  private validateAndQuoteSchema(schema: string): string {
    if (!schema) {
      throw new Error('Schema name is required');
    }
    const sanitizedSchema = schema.replace(/[^a-zA-Z0-9_-]/g, '');
    if (sanitizedSchema !== schema) {
      throw new Error(`Invalid schema name: ${schema}. Only alphanumeric characters, underscores, and hyphens are allowed.`);
    }
    return `"${sanitizedSchema}"`;
  }

  mapSourceToTarget(file: ItemInfo, jobRunId: string, pathId: string): any {
    if (!file) {
      throw new ValidationError('Invalid file object: Cannot map undefined or null file', 'file');
    }
    const fullPath = file.fileName ?? '';
    let actualFileName = '';
    let parentPath = '';
    if (fullPath) {
      const isWindowsPath = fullPath.startsWith('\\');
      const pathModule = isWindowsPath ? path.win32 : path.posix;
      actualFileName = pathModule.basename(fullPath);
      parentPath = pathModule.dirname(fullPath);
    }
    return {
      path: fullPath,
      isDirectory: file.isDirectory ?? false,
      sourceChecksum: file?.sourceMeta?.checksum ?? null,
      targetChecksum: file?.targetMeta?.checksum ?? null,
      parentPath: parentPath,
      depth: file?.depth ?? 0,
      fileName: actualFileName,
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
      isDeleted: file?.isDeleted ?? false,
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

    const deletedDirectories = data.filter(item => 
      item.isDirectory && item.isDeleted
    );

    for (const deletedDir of deletedDirectories) {
      const directoryPath = deletedDir.fileName;
      
      const schema = this.validateAndQuoteSchema(process.env.SCHEMA || InventoryService.DEFAULT_SCHEMA);
      const existingDir = await this.dataSource.query(`
        SELECT i.is_deleted 
        FROM ${schema}.inventory i
        WHERE i.job_run_id = $1 AND i.path = $2
        LIMIT 1
      `, [jobRunId, directoryPath]);
      
      if (existingDir.length > 0 && existingDir[0].is_deleted) {
        this.logger.log(`Directory ${directoryPath} is already marked as deleted, skipping tree deletion`);
        continue;
      }
      
      await this.markDirectoryTreeAsDeleted(directoryPath, jobRunId, pathId, schema);
    }

    const regularItems = data.filter(item => 
      !(item.isDirectory && item.isDeleted)
    );

    if (regularItems.length === 0) {
      return;
    }

    const batchSize = 500; // Adjust batch size as needed
    const failedRecords: ItemInfo[] = [];

    for (let i = 0; i < regularItems.length; i += batchSize) {
      const batch = regularItems.slice(i, i + batchSize);
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

  async markDirectoryTreeAsDeleted(directoryPath: string, jobRunId: string, pathId: string, schema: string): Promise<void> {
    try {
        const relatedJobsResult = await this.dataSource.query(`
          WITH current_job AS (
            SELECT jc.source_path_id, jc.target_path_id
            FROM ${schema}.jobrun jr
            JOIN ${schema}.jobconfig jc ON jr.job_config_id = jc.id
            WHERE jr.id = $1
          )
          SELECT jr.id 
          FROM ${schema}.jobrun jr
          JOIN ${schema}.jobconfig jc ON jr.job_config_id = jc.id
          JOIN current_job cj ON (jc.source_path_id, jc.target_path_id) = (cj.source_path_id, cj.target_path_id)
          ORDER BY jr.start_time DESC
        `, [jobRunId]);

        if (!relatedJobsResult.length) {
          this.logger.error(`Job config not found for job run: ${jobRunId}`);
          return;
        }
        
        const isWindowsDirectoryPath = directoryPath.startsWith('\\');
        const escapedDirectoryPath = directoryPath
          .replace(/\\/g, '\\\\')      
          .replace(/!/g, '!!')         
          .replace(/[%_]/g, '!$&');   
          
        const likePattern = isWindowsDirectoryPath 
          ? `${escapedDirectoryPath}\\\\%`  
          : `${escapedDirectoryPath}/%`;  
        
        this.logger.log(`Checking for items to mark as deleted under directory: ${directoryPath} for current job run: ${jobRunId}`);
        const batchSize = 1000;
        let processedCount = 0;
        let lastProcessedPath: string | null = null;  
        let batchNumber = 0;

        while (true) {
          try {
            batchNumber++;
            
            const queryParams: any[] = [
              relatedJobsResult.map(jr => jr.id),
              likePattern,
              directoryPath,
              batchSize
            ];
            
            let cursorCondition = '';
            if (lastProcessedPath !== null) {
              cursorCondition = 'AND path > $5';
              queryParams.push(lastProcessedPath);
            }
            
            const filesToMarkDeleted = await this.dataSource.query(`
              WITH latest_records AS (
                SELECT DISTINCT ON (path) path, is_directory, file_size, extension, file_type, file_permission, uid, gid, depth, is_deleted
                FROM ${schema}.inventory
                WHERE job_run_id = ANY($1)
                  AND (path LIKE $2 ESCAPE '!' OR path = $3)
                ORDER BY path, updated_at DESC NULLS LAST
              )
              SELECT path, is_directory, file_size, extension, file_type, file_permission, uid, gid, depth
              FROM latest_records
              WHERE (is_deleted = false OR is_deleted IS NULL)
                ${cursorCondition}
              ORDER BY path
              LIMIT $4
            `, queryParams);

            this.logger.log(`Batch ${batchNumber}: Retrieved ${filesToMarkDeleted?.length || 0} files from database`);
            if (!filesToMarkDeleted || filesToMarkDeleted.length === 0) {
              break;
            }
            
            lastProcessedPath = filesToMarkDeleted[filesToMarkDeleted.length - 1].path;
            this.logger.log(`Processing files: ${filesToMarkDeleted.map(f => f.path).join(', ')}`);
        
            const deletedEntries = filesToMarkDeleted.map(file => {
              const isWindowsPath = file.path.startsWith('\\');
              const pathModule = isWindowsPath ? path.win32 : path.posix;
              return {
                path: file.path,
                isDirectory: file.is_directory || false,
                sourceChecksum: null,
                targetChecksum: null,
                parentPath: pathModule.dirname(file.path),
                depth: file.depth ?? 0,
                fileName: pathModule.basename(file.path),
                uid: file.uid || '',
                gid: file.gid || '',
                fileSize: file.file_size ? BigInt(file.file_size).toString() : '0',
                extension: file.extension || '',
                fileType: file.file_type || 'file',
                modifiedTime: file?.targetMeta?.modifiedTime ?? file?.sourceMeta?.modifiedTime ?? null,
                accessTime: file?.targetMeta?.accessTime ?? file?.sourceMeta?.accessTime ?? null,
                permission: file.file_permission || '0644',
                jobRunId: jobRunId,
                birthTime: file?.targetMeta?.birthTime ?? file?.sourceMeta?.birthTime ?? null,
                pathId: pathId,
                sourceMeta: file?.sourceMeta ?? null,
                targetMeta: file?.targetMeta ?? null,
                inode: null,
                isDeleted: true,
              };
            });
      
          this.logger.log(`About to upsert ${deletedEntries.length} entries`);
          await this.inventoryRepo.upsert(deletedEntries, ['path', 'jobRunId', 'isDirectory']);
          processedCount += deletedEntries.length;
          this.logger.log(`Batch ${batchNumber} processed: ${deletedEntries.length} items marked as deleted (${processedCount} total) for directory: ${directoryPath}`);
          } catch (batchError) {
            this.logger.error(`Failed to process batch ${batchNumber} for directory ${directoryPath}: ${batchError.message}`, batchError.stack);
          }
        }
        this.logger.log(`Successfully marked ${processedCount} items (files and directories) as deleted for directory: ${directoryPath}`);
    } catch (error) {
      this.logger.error(`Failed to mark directory tree as deleted ${directoryPath}: ${error.message}`, error.stack);
    }
  }

  async saveOperationError(data: OperationError) {
    try {
      if (!data || !data.operationId) {
        throw new ValidationError('Invalid operation error data', 'data');
      }

      // Save error for current operation
      const operationError = this.operationErrorRepo.create({
        errorCode: data.errorCode,
        errorMessage: data.errorMessage,
        operationId: data.operationId,
        fileName: data.errorFiles?.fileName ?? null,
        filePath: data.errorFiles?.filePath ?? null,
        createdAt: new Date(),
        error_type: data?.errorType || null,
        operationType: data?.operationName || null,
        origin: data?.origin || null,
      });

      await this.operationErrorRepo.save(operationError);

      // Sync error to original job run if this is a retry
      await this.syncErrorToOriginalJobRun(data);

    } catch (err) {
      this.logger.error(`Failed to save operation error: ${err.message}`, err?.stack || err);
      throw new DatabaseError("Error while saving operation error records to the database", err);
    }
  }

  /**
   * Syncs an error to the original job run during retry operations.
   * Only creates operation + error for NEW files discovered during retry.
   * If the file already existed in the original job run, it already has an error there.
   */
  private async syncErrorToOriginalJobRun(data: OperationError): Promise<void> {
    if (!data.originalJobRunId || !data.errorFiles?.filePath) {
      return;
    }

    try {
      // Check if operation already exists in original job run
      const existingOperation = await this.operationRepo.findOne({
        where: {
          fPath: data.errorFiles.filePath,
          jobRunId: data.originalJobRunId
        }
      });

      // Only create operation + error for NEW files not in original job run
      if (!existingOperation) {
        const newOperation = await this.createOperationInOriginalJobRun(
          data.originalJobRunId,
          data.errorFiles.filePath
        );
        await this.upsertOperationError(newOperation.id, data);
        
        this.logger.log(
          `Synced new error to original job run ${data.originalJobRunId} for file ${data.errorFiles.filePath}`
        );
      }
      // If operation exists, error is already tracked there - no action needed
    } catch (err) {
      this.logger.error(
        `Failed to sync error to original job run ${data.originalJobRunId}: ${err.message}`,
        err?.stack || err
      );
      // Don't throw - this is supplementary to the main error save
    }
  }

  /**
   * Creates a new operation in the original job run for error tracking.
   * Used during retry when a new file (not in original errors) fails.
   */
  private async createOperationInOriginalJobRun(
    originalJobRunId: string,
    filePath: string
  ): Promise<OperationsEntity> {
    // Get path IDs from any existing operation in the original job run
    const existingOp = await this.operationRepo.findOne({
      where: { jobRunId: originalJobRunId },
      select: ['sPathId', 'tPathId']
    });

    // Create new operation for error tracking
    const newOperation = this.operationRepo.create({
      fPath: filePath,
      jobRunId: originalJobRunId,
      status: OperationStatus.ERROR,
      operationType: OperationType.SCAN,
      request: {},
      sPathId: existingOp?.sPathId ?? null,
      tPathId: existingOp?.tPathId ?? null,
      retryCount: 0,
    });

    return await this.operationRepo.save(newOperation);
  }

  /**
   * Upserts an operation error record.
   * Updates existing error or inserts new one based on operationId + filePath.
   */
  private async upsertOperationError(
    operationId: string,
    data: OperationError
  ): Promise<void> {
    await this.operationErrorRepo.upsert({
      errorCode: data.errorCode,
      errorMessage: data.errorMessage,
      operationId: operationId,
      fileName: data.errorFiles?.fileName ?? null,
      filePath: data.errorFiles?.filePath ?? null,
      createdAt: new Date(),
      error_type: data?.errorType || null,
      operationType: data?.operationName || null,
      origin: data?.origin || null,
      errorStatus: 'UNRESOLVED',
    }, ['operationId', 'filePath']);
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

      // Resolve operation errors for completed retry commands
      // Commands with originalCmdId are retry commands - resolve the original command's errors
      // Must match both operationId AND filePath since one operation can have multiple file errors
      if ([TaskStatus.COMPLETED, TaskStatus.COMPLETED_WITH_ERROR].includes(status) && Array.isArray(commands)) {
        const errorsToResolve = commands
          .filter((cmd: any) => cmd.originalCmdId && cmd.status === CommandStatus.COMPLETED)
          .map((cmd: any) => ({ operationId: cmd.originalCmdId, filePath: cmd.fPath }));
        
        if (errorsToResolve.length > 0) {
          await this.resolveOperationErrors(errorsToResolve);
        }
      }
    } catch (err) {
      this.logger.error(`Failed to save task records: ${err.message}`, err?.stack || err);
    }
  }


  /**
   * Resolves operation errors by updating their status from UNRESOLVED to RESOLVED.
   * This is called when retry operations complete successfully.
   * 
   * Must match both operationId AND filePath because:
   * - One operation can produce multiple file errors (e.g., directory scan fails on multiple files)
   * - Same file path could have errors from different operations
   * 
   * @param errors - Array of {operationId, filePath} pairs to resolve
   */
  async resolveOperationErrors(errors: { operationId: string; filePath: string }[]): Promise<void> {
    if (!errors || errors.length === 0) {
      return;
    }

    try {
      // Build WHERE conditions for each error
      const whereConditions = errors.map((_, index) => 
        `(operation_id = :opId${index} AND file_path = :fPath${index})`
      );

      // Build parameters object
      const parameters = errors.reduce((params, error, index) => ({
        ...params,
        [`opId${index}`]: error.operationId,
        [`fPath${index}`]: error.filePath,
      }), {} as Record<string, string>);

      // Execute the update
      const result = await this.operationErrorRepo
        .createQueryBuilder()
        .update()
        .set({ errorStatus: 'RESOLVED' })
        .where(whereConditions.join(' OR '), parameters)
        .execute();

      this.logger.log(`Resolved ${result.affected || 0} operation errors for ${errors.length} error pairs`);
    } catch (error) {
      this.logger.error(`Failed to resolve operation errors: ${error.message}`, error?.stack || error);
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
      const schemaName = process.env.SCHEMA || InventoryService.DEFAULT_SCHEMA;
      const safeSchema = this.validateAndQuoteSchema(schemaName);
      await this.dataSource.query(
        `CALL ${safeSchema}.create_inventory_partition($1, $2);`,
        [jobRunId, schemaName],
      );
      this.logger.log(`Partition table  created or already exists for job run ID: ${jobRunId}`);
    } catch (error) {
      this.logger.error(`Failed to create partition table for jobRunId ${jobRunId}: ${error.message}`, error?.stack || error);
      throw new DatabaseError("Error while creating partition inventory table", error);
    }
  }
}
