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
  private readonly schema: string;
  private readonly schemaName: string;

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
    this.schemaName = process.env.SCHEMA || InventoryService.DEFAULT_SCHEMA;
    this.schema = this.validateAndQuoteSchema(this.schemaName);
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
      modifiedTime: file?.targetMeta?.modifiedTime ?? file?.sourceMeta?.modifiedTime ?? new Date(),
      accessTime: file?.targetMeta?.accessTime ?? file?.sourceMeta?.accessTime ?? new Date(),
      permission: file?.targetMeta?.permission ?? file?.sourceMeta?.permission ?? null,
      jobRunId: jobRunId,
      birthTime: file?.targetMeta?.birthTime ?? file?.sourceMeta?.birthTime ?? new Date(),
      pathId: pathId,
      sourceMeta: file?.sourceMeta ?? null,
      targetMeta: file?.targetMeta ?? null,
      inode: file?.inode ?? null,
      isDeleted: file?.isDeleted ?? false,
      checksumTime: (file as any)?.checksumTime ?? null,
      copyContentStatus: (file as any)?.copyContentStatus ?? null,
      stampMetaDataStatus: (file as any)?.stampMetaDataStatus ?? null,
      entryType: this.normalizeEntryType((file as any)?.entryType),
      updateType: (file as any)?.updateType ?? null,
    };
  }

  /** entry_type: 'excluded' | 'skipped' from payload, otherwise 'inventory'. */
  private normalizeEntryType(entryType: string | null | undefined): string {
    if (entryType === 'excluded' || entryType === 'skipped') return entryType;
    return 'inventory';
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

  async getInventoryEntryTypesForPaths(
    jobRunId: string,
    paths: Array<{ path: string; isDirectory: boolean }>,
    schemaOverride?: string,
  ): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    if (!paths?.length) return result;
    const schema =
      schemaOverride ??
      this.validateAndQuoteSchema(process.env.SCHEMA || InventoryService.DEFAULT_SCHEMA);
    const pathArr = paths.map((p) => p.path);
    const isDirArr = paths.map((p) => p.isDirectory);
    const rows = await this.dataSource.query(
      `SELECT i.path, i.is_directory, i.entry_type
       FROM ${schema}.inventory i
       JOIN unnest($2::text[], $3::boolean[]) AS inp(path, is_directory)
         ON i.path = inp.path
        AND i.is_directory = inp.is_directory
       WHERE i.job_run_id = $1`,
      [jobRunId, pathArr, isDirArr],
    );
    for (const r of rows as Array<{ path: string; is_directory: boolean; entry_type: string | null }>) {
      const k = `${r.path}|${jobRunId}|${r.is_directory}`;
      result.set(k, r.entry_type ?? null);
    }
    return result;
  }

  async computeInventoryDelta(
    jobRunId: string,
    items: Array<{ path: string; isDirectory: boolean; size: number }>,
  ): Promise<{ fileCount: number; dirCount: number; totalSize: bigint }> {
    if (!items?.length) return { fileCount: 0, dirCount: 0, totalSize: BigInt(0) };
    const schema = this.schema;
    const pathArr = items.map((p) => p.path);
    const isDirArr = items.map((p) => p.isDirectory);
    const sizeArr = items.map((p) => p.size ?? 0);
    const rows = await this.dataSource.query(
      `SELECT
         COUNT(*)        FILTER (WHERE i.path IS NULL AND inp.is_directory = false) AS new_file_count,
         COUNT(*)        FILTER (WHERE i.path IS NULL AND inp.is_directory = true)  AS new_dir_count,
         COALESCE(SUM(inp.size) FILTER (WHERE i.path IS NULL AND inp.is_directory = false), 0) AS new_total_size
       FROM unnest($2::text[], $3::boolean[], $4::bigint[]) AS inp(path, is_directory, size)
       LEFT JOIN ${schema}.inventory i
         ON i.path = inp.path
        AND i.is_directory = inp.is_directory
        AND i.job_run_id = $1`,
      [jobRunId, pathArr, isDirArr, sizeArr],
    );
    const row = rows[0];
    return {
      fileCount: Number(row.new_file_count),
      dirCount:  Number(row.new_dir_count),
      totalSize: BigInt(row.new_total_size),
    };
  }


  async createInventory(data: ItemInfo[], jobRunId: string, pathId: string): Promise<ItemInfo[]> {
    if (!data || data.length === 0) {
      return [];
    }

    const deletedDirectories = data.filter(item => 
      item.isDirectory && item.isDeleted
    );

    const regularItems = data.filter(item => 
      !(item.isDirectory && item.isDeleted)
    );

    const failedRecords: ItemInfo[] = [];

    // Write regular items FIRST so that when we process deleted-directory markers
    // below, the tree-deletion query can find children that arrived in the same batch.
    if (regularItems.length > 0) {
      const batchSize = parseInt(process.env.DB_UPSERT_BATCH_SIZE) || 1000;
      const writtenInThisCall = new Set<string>();
      for (let i = 0; i < regularItems.length; i += batchSize) {
        const batch = regularItems.slice(i, i + batchSize);
        try {
          const mapped = batch
            .map(item => this.mapSourceToTarget(item, jobRunId, pathId))
            .reduce((acc, curr) => {
              const key = `${curr.path}|${curr.jobRunId}|${curr.isDirectory}`;
              acc[key] = curr;
              return acc;
            }, {} as Record<string, any>);

          const paths = Object.values(mapped) as Array<{ path: string; isDirectory: boolean }>;
          const entryTypesByKey = await this.getInventoryEntryTypesForPaths(jobRunId, paths, this.schema);
          const existingInDb = new Set(entryTypesByKey.keys());
          writtenInThisCall.forEach(k => existingInDb.add(k));

          const mappedData = Object.values(mapped).map((row: any) => {
            const key = `${row.path}|${row.jobRunId}|${row.isDirectory}`;
            if (row.entryType !== 'excluded' && row.entryType !== 'skipped' && row.updateType == null) {
              row.updateType = existingInDb.has(key) ? 'content_updated' : 'new';
            }
            return row;
          });

          await this.inventoryRepo.upsert(mappedData, ['path', 'jobRunId', 'isDirectory']);
          mappedData.forEach((row: any) => writtenInThisCall.add(`${row.path}|${row.jobRunId}|${row.isDirectory}`));
        } catch (err) {
          this.logger.error(`Failed to save inventory batch: ${err.message}`, err?.stack || err);
          failedRecords.push(...batch);
        }
      }
    }

    // Process deleted-directory markers AFTER regular items are persisted.
    for (const deletedDir of deletedDirectories) {
      const directoryPath = deletedDir.fileName;
      
      const schema = this.schema;
      const existingDir = await this.dataSource.query(`
        SELECT i.is_deleted 
        FROM ${schema}.inventory i
        WHERE i.job_run_id = $1 AND i.path = $2 AND i.is_directory = true
        LIMIT 1
      `, [jobRunId, directoryPath]);
      
      if (existingDir.length > 0 && existingDir[0].is_deleted) {
        this.logger.debug(`Directory ${directoryPath} is already marked as deleted, skipping tree deletion`);
        continue;
      }
      
      const deletionFailures = await this.markDirectoryTreeAsDeleted(deletedDir, jobRunId, pathId, schema);
      failedRecords.push(...deletionFailures);
    }

    if (failedRecords.length > 0) {
      this.logger.log(`Failed to save ${failedRecords.length} of ${data.length} inventory records`);
      return failedRecords;
    }
    return [];
  }

  /**
   * Marks all inventory rows under a deleted directory path, and ensures a row exists
   * for the directory itself when the worker reports a directory delete but nothing was
   * returned from inventory (e.g. empty folder or no prior directory row).
   *
   * Returns the deleted-directory marker in an array if any batch upsert failed so the
   * caller can surface it in failedRecords — mirrors the regular-item batch pattern.
   * Returns an empty array on full success.
   */
  async markDirectoryTreeAsDeleted(deletedDir: ItemInfo, jobRunId: string, pathId: string, schema: string): Promise<ItemInfo[]> {
    const directoryPath = deletedDir.fileName ?? '';
    let hadBatchFailure = false;
    try {
        if (!directoryPath) {
          this.logger.warn('markDirectoryTreeAsDeleted: missing fileName on deleted directory marker');
          return [];
        }

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
          return [];
        }
        
        const isWindowsDirectoryPath = directoryPath.startsWith('\\') || directoryPath.includes('\\');  
        const escapedDirectoryPath = directoryPath
          .replace(/\\/g, '\\\\')      
          .replace(/!/g, '!!')         
          .replace(/[%_]/g, '!$&');   
          
        const likePattern = isWindowsDirectoryPath 
          ? `${escapedDirectoryPath}\\\\%`  
          : `${escapedDirectoryPath}/%`;  
        
        this.logger.debug(`Checking for items to mark as deleted under directory: ${directoryPath} for current job run: ${jobRunId}`);
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
                SELECT DISTINCT ON (path) path, is_directory, file_size, extension, file_type, file_permission, uid, gid, depth, is_deleted,
                       modified_time, access_time, birth_time
                FROM ${schema}.inventory
                WHERE job_run_id = ANY($1)
                  AND (path LIKE $2 ESCAPE '!' OR path = $3)
                ORDER BY path, updated_at DESC NULLS LAST
              )
              SELECT path, is_directory, file_size, extension, file_type, file_permission, uid, gid, depth,
                     modified_time, access_time, birth_time
              FROM latest_records
              WHERE (is_deleted = false OR is_deleted IS NULL)
                ${cursorCondition}
              ORDER BY path
              LIMIT $4
            `, queryParams);

            this.logger.debug(`Batch ${batchNumber}: Retrieved ${filesToMarkDeleted?.length || 0} files from database`);
            if (!filesToMarkDeleted || filesToMarkDeleted.length === 0) {
              break;
            }
            
            lastProcessedPath = filesToMarkDeleted[filesToMarkDeleted.length - 1].path;
            this.logger.debug(`Processing files: ${filesToMarkDeleted.map(f => f.path).join(', ')}`);
        
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
                modifiedTime: file.modified_time ?? new Date(),
                accessTime: file.access_time ?? new Date(),
                permission: file.file_permission || '0644',
                jobRunId: jobRunId,
                birthTime: file.birth_time ?? new Date(),
                pathId: pathId,
                sourceMeta: null,
                targetMeta: null,
                inode: null,
                isDeleted: true,
                copyContentStatus: null,
                stampMetaDataStatus: null,
              };
            });
      
          this.logger.debug(`About to upsert ${deletedEntries.length} entries`);
          await this.inventoryRepo.upsert(deletedEntries, ['path', 'jobRunId', 'isDirectory']);
          processedCount += deletedEntries.length;
          this.logger.debug(`Batch ${batchNumber} processed: ${deletedEntries.length} items marked as deleted (${processedCount} total) for directory: ${directoryPath}`);
          } catch (batchError) {
            this.logger.error(`Failed to process batch ${batchNumber} for directory ${directoryPath}: ${batchError.message}`, batchError.stack);
            hadBatchFailure = true;
          }
        }

        const dirSelfRows = await this.dataSource.query(
          `SELECT is_deleted FROM ${schema}.inventory
           WHERE job_run_id = $1 AND path = $2 AND is_directory = true
           LIMIT 1`,
          [jobRunId, directoryPath],
        );
        const dirRowAlreadyDeleted =
          dirSelfRows.length > 0 && dirSelfRows[0].is_deleted === true;
        if (!dirRowAlreadyDeleted) {
          const tombstone = this.mapSourceToTarget(
            { ...deletedDir, fileName: directoryPath, isDeleted: true, isDirectory: true } as ItemInfo,
            jobRunId,
            pathId,
          );
          await this.inventoryRepo.upsert([tombstone], ['path', 'jobRunId', 'isDirectory']);
          processedCount += 1;
          this.logger.debug(
            `Ensured deleted inventory row for directory path ${directoryPath} (jobRunId=${jobRunId})`,
          );
        }

        this.logger.log(`Successfully marked ${processedCount} items (files and directories) as deleted for directory: ${directoryPath}`);
    } catch (error) {
      this.logger.error(`Failed to mark directory tree as deleted ${directoryPath}: ${error.message}`, error.stack);
      return [deletedDir];
    }

    if (hadBatchFailure) {
      this.logger.warn(`One or more batches failed while marking directory tree as deleted for: ${directoryPath}`);
      return [deletedDir];
    }
    return [];
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
    // fileName holds the relative fPath (command.fPath), filePath holds the absolute targetPath.
    // Operations are stored with relative fPath, so we must use fileName for the lookup.
    const relativeFPath = data.errorFiles?.fileName;
    if (!data.originalJobRunId || !relativeFPath) {
      return;
    }

    try {
      // Check if operation already exists in original job run
      const existingOperation = await this.operationRepo.findOne({
        where: {
          fPath: relativeFPath,
          jobRunId: data.originalJobRunId
        }
      });

      // Only create operation + error for NEW files not in original job run
      if (!existingOperation) {
        const newOperation = await this.createOperationInOriginalJobRun(
          data.originalJobRunId,
          relativeFPath   // store relative path, consistent with all other operations
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

  private getOperationStatusFor(commandStatus: CommandStatus): OperationStatus {
    switch (commandStatus) {
      case CommandStatus.READY:
        return OperationStatus.READY;
      case CommandStatus.IN_PROCESS:
        return OperationStatus.IN_PROCESS;
      case CommandStatus.COMPLETED:
        return OperationStatus.COMPLETED;
      case CommandStatus.ERROR:
        return OperationStatus.ERROR;
    }
  }

  async saveTasks(data: any) {
    if (!data || !data.jobRunId || !data.taskType || !data.status) {
      throw new ValidationError("Invalid task data", 'data');
    }
    
    try {
      const { jobRunId, taskType, status, sPathId, tPathId, commands, workerId, id, retryCount } = data;
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
  
        if (!task || ![TaskStatus.COMPLETED, TaskStatus.COMPLETED_WITH_ERROR].includes(task?.status)) {
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
            status: this.getOperationStatusFor(command.status),
            retryCount: retryCount ?? 0,
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
   * Joins to operations table to match on operations.f_path (relative path) because:
   * - operation_errors.file_path stores full absolute path (e.g., /mnt/jobRunId/pathId/data/file.txt)
   * - operations.f_path stores relative path (e.g., /data/file.txt)
   * - Retry commands use relative paths matching operations.f_path
   * 
   * @param errors - Array of {operationId, filePath} pairs to resolve (filePath is relative)
   */
  async resolveOperationErrors(errors: { operationId: string; filePath: string }[]): Promise<void> {
    if (!errors || errors.length === 0) {
      return;
    }

    try {
      // Build WHERE conditions for each error (each error uses two params: operationId, filePath)
      const whereConditions = errors.map((_, index) => {
        const p1 = index * 2 + 1;
        return `(oe.operation_id = $${p1} AND o.f_path = $${p1 + 1})`;
      });

      // Build parameters array for raw query
      const parameters: string[] = [];
      errors.forEach(error => {
        parameters.push(error.operationId, error.filePath);
      });

      // Execute the update with a subquery that joins to operations table
      // This matches operation_errors by operation_id where the linked operation has matching f_path
      const query = `
        UPDATE datamigrator.operation_errors
        SET error_status = 'RESOLVED'
        WHERE id IN (
          SELECT oe.id
          FROM datamigrator.operation_errors oe
          INNER JOIN datamigrator.operations o ON oe.operation_id = o.id
          WHERE ${whereConditions.join(' OR ')}
        )
      `;


      await this.operationErrorRepo.query(query, parameters);

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
      await this.dataSource.query(
        `CALL ${this.schema}.create_inventory_partition($1, $2);`,
        [jobRunId, this.schemaName],
      );
      this.logger.log(`Partition table  created or already exists for job run ID: ${jobRunId}`);
    } catch (error) {
      this.logger.error(`Failed to create partition table for jobRunId ${jobRunId}: ${error.message}`, error?.stack || error);
      throw new DatabaseError("Error while creating partition inventory table", error);
    }
  }
}
