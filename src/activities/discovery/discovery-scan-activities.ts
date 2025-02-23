
import { DMError, JobContext, JobStatus, TaskStats } from '@netapp-cloud-datamigrate/jobs-lib';
import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
// local imports
import { DiscoveryPayload, FileEntry, FileType, ProcessFolderReadParams, ProcessInventoryParams } from '../types/tasks';
import { OperationStatus, TaskStatus } from './enums';
import { JobState } from '@netapp-cloud-datamigrate/jobs-lib/dist/types/job-state';
import { RedisService } from 'src/redis/redis.service';

@Injectable()
export class DiscoveryScanActivity {
  constructor(
    private readonly logger: Logger,
    private readonly redisService: RedisService,
  ) {}

  async scanActivity(payload: DiscoveryPayload, traceId: string): Promise<TaskStats> {
    this.logger.log(`[${traceId}] Starting Discovery Scan Activity`);
    const jobContext: JobContext = await this.redisService.getJobContext(traceId);
    const jobState: JobState = await jobContext.getJobState();
    payload.data.status = TaskStatus.Running
    payload.data.commands.map((cmd: any) => cmd.status = OperationStatus.IN_PROCESS);
    const id = await jobContext.appendToUpdatedTaskList(payload.data);
    jobContext.updatedTaskInfo.lastId = id;
    await this.redisService.setJobContext(traceId, jobContext);
    const discoveryStats = new TaskStats('SCAN');
    const result = await this.discovery(payload, jobContext, discoveryStats);
    const newJobState = { ...jobState, tasks_completed: jobState.tasks_completed + 1 };
    jobContext.jobState = new JobState(newJobState.workers, newJobState.tasks_completed, newJobState.tasks_total, newJobState.workers_agreed, newJobState.status as JobStatus);
    await this.redisService.setJobContext(traceId, jobContext);
    this.logger.log(`[${traceId}] Discovery Scan Activity Completed.`);
    return result;
  }

  async discovery(data: DiscoveryPayload, jobContext: JobContext, discoveryStats: TaskStats, batchSize: number = 1000): Promise<TaskStats> {
    const inventoryData = [];
    if (!data) {
      this.logger.log(`[${jobContext.jobRunId}] No data found for discovery`);
      return;
    }
    const ids = { jobRunId: data.data.jobRunId, workerId: data.data.workerId, transactionId: '', taskId: data.data.id, traceId: data.data.jobRunId };
    try {
      await Promise.all(data.data.commands.map(async cmd => {
        try {
          this.logger.log(`[${jobContext.jobRunId}] Processing command: ${JSON.stringify(cmd)}`);
          const { fPath } = cmd;
          const files = await fs.promises.readdir(fPath);
          this.logger.log(`[${jobContext.jobRunId}] Inventories Discovered: ${JSON.stringify(files)}`);
          const { accumulatedResult } = await this.processFolderRead({
            files,
            chunkPath: fPath,
            jobRunId: ids.jobRunId,
            pathId: data.data.sPath,
            batchSize,
            workerId: ids.workerId,
            commandId: cmd.commandId || 'test',
            excludePattern: [],
            taskId: ids.taskId,
            jobContext,
            discoveryStats
          });
          inventoryData.push(...accumulatedResult);
          if (inventoryData.length >= batchSize) {
            const batch = inventoryData.splice(0, batchSize);
            await this.processInventory({ inventory: batch, jobContext, taskId: ids.taskId, discoveryStats });
          }
          return { ...cmd, ops: { 0: { ...cmd.ops[0], status: OperationStatus.COMPLETED } } };
        } catch (error) {
          const errorCode = this.getErrorCode(error, 'OPERATION');
          await this.processErrors(new DMError(null, { operationId: cmd.commandId, errorCode, errorMessage: error.message, errorFiles: { fileName: cmd.fPath, filePath: cmd.commandId } }), jobContext, discoveryStats);
          return { ...cmd, ops: { 0: { ...cmd.ops[0], status: OperationStatus.ERROR } } };
        }
      }));
      await this.processInventory({ inventory: inventoryData, jobContext, taskId: ids.taskId, discoveryStats });
      data.data.status = TaskStatus.Completed;
      data.data.commands.map((cmd: any) => cmd.status = OperationStatus.COMPLETED);
      const taskId = await jobContext.appendToUpdatedTaskList(data.data);
      jobContext.updatedTaskInfo.lastId = taskId;
      this.redisService.setJobContext(data.data.jobRunId, jobContext);
      return discoveryStats;
    } catch (error) {
      const errorCode = this.getErrorCode(error, 'TASK');
      await this.processErrors(new DMError({ taskId: ids.taskId, errorCode, errorMessage: error.message }), jobContext, discoveryStats);
    }
  }

  async processFolderRead({
    files,
    chunkPath,
    jobRunId,
    pathId,
    batchSize,
    excludePattern,
    taskId,
    jobContext,
    discoveryStats,
    commandId
  }: ProcessFolderReadParams) {
    try {
      const accumulatedResult = [];
      for (const file of files) {
        try {
          const fullPath = path.join(chunkPath, file);
          const lStat = await fs.promises.lstat(fullPath);
          const isDirectory = lStat.isDirectory();
          const shouldExcludeFile = this.shouldExclude(fullPath, excludePattern);
          if (shouldExcludeFile) continue;
          if(isDirectory) discoveryStats.numDirs += 1;
          else discoveryStats.numFiles += 1;
          const entry: FileEntry = {
            taskId,
            pathId,
            fileName: file,
            path: fullPath,
            parentPath: chunkPath,
            jobRunId,
            isDirectory,
            uid: lStat.uid.toString(),
            gid: lStat.gid.toString(),
            fileSize: lStat.size,
            blocks: lStat.blocks,
            modifiedTime: new Date(lStat.mtime).toISOString(),
            birthTime: new Date(lStat.birthtime).toISOString(),
            extension: path.extname(file),
            permission: this.getFilePermissions(lStat),
            accessTime: new Date(lStat.atime).toISOString(),
            fileType: this.getFileType(lStat),
            depth: fullPath.split('/').length - 2,
            commandId
          };
          accumulatedResult.push(entry);
          if (accumulatedResult.length >= batchSize) {
            const batch = accumulatedResult.splice(0, batchSize);
            await this.processInventory({ inventory: batch, jobContext, taskId, discoveryStats });
          }
        } catch (operationError) {
          const errorCode = this.getErrorCode(operationError, 'OPERATION');
          await this.processErrors(new DMError(null, {
            operationId: taskId,
            errorCode,
            errorMessage: operationError.message,
            errorFiles: {
              fileName: file,
              filePath: path.join(chunkPath, file),
            },
          }), jobContext, discoveryStats)
        }
      }
      return { accumulatedResult };
    } catch (error) {
      const errorCode = this.getErrorCode(error, 'OPERATION');
      await this.processErrors(new DMError(null, { operationId: commandId, errorCode: errorCode, errorMessage: error.message, errorFiles: { fileName: chunkPath, filePath: chunkPath } }), jobContext, discoveryStats);
    }
  }

  private async processInventory({ inventory, jobContext, taskId, discoveryStats }: ProcessInventoryParams): Promise<any> {
    try {
      this.logger.log(`[${jobContext.jobRunId}] Processing ${inventory.length} inventory`);
      let currentCommandId = '';
      const result = await Promise.all(
        inventory.map(async (item: any) => {
          if (item.isDirectory) {
            try {
              currentCommandId = item.commandId;
              delete item.commandId;
              const id = await jobContext.appendToDirList(item);
              jobContext.dirsInfo.lastId = id;
              jobContext.dirsInfo.numMessages++;
              this.logger.log(`[${jobContext.jobRunId}] *************** Appending to dir list ***************`);
            } catch (error) {
              const errorCode = this.getErrorCode(error, 'OPERATION');
              await this.processErrors(new DMError(null, { operationId: currentCommandId, errorCode, errorMessage: error.message, errorFiles: { fileName: item.fileName, filePath: item.parentPath } }), jobContext, discoveryStats);
            }
          }
          try {
            currentCommandId = item.commandId;
            delete item.commandId;
            const id = await jobContext.appendToFileList(item);
            jobContext.filesInfo.lastId = id;
            jobContext.filesInfo.numMessages++;
            this.logger.log(`[${jobContext.jobRunId}] *************** Appending to file list ***************`);
          } catch (error) {
            const errorCode = this.getErrorCode(error, 'OPERATION');
            await this.processErrors(new DMError(null, { operationId: currentCommandId, errorCode, errorMessage: error.message, errorFiles: { fileName: item.fileName, filePath: item.parentPath } }), jobContext, discoveryStats);
          }
        })
      );
      this.logger.log(`[${jobContext.jobRunId}] Processed ${inventory.length} inventory data`);
      return result;
    } catch (error) {
      const errorCode = this.getErrorCode(error, 'TASK');
      await this.processErrors(new DMError({ taskId: taskId, errorCode, errorMessage: error.message }), jobContext, discoveryStats);
    }
  }

  async processErrors(error: DMError, jobContext: JobContext, discoveryStats: TaskStats) {
    this.logger.error(`[${jobContext.jobRunId}] Error encountered: ${JSON.stringify(error)}`);
    discoveryStats.numErrors += 1;
    await jobContext.appendToErrorList(error);
  }

  shouldExclude(fullPath: string, excludePatterns: string[]): boolean {
    if (!excludePatterns.length) return false;
    const normalizedPath = fullPath.endsWith('/') ? fullPath : `${fullPath}/`;
    const regexPatterns = excludePatterns.map(pattern => {
      const escapedPattern = pattern.replace(/[-\/\\^$+?.()|[\]{}]/g, '\\$&');
      const regexString = escapedPattern.replace(/\*/g, '.*');
      return new RegExp(`^${regexString}`, 'i');
    });
    const fullPathSplit = fullPath.split('/');
    for (let pattern of excludePatterns) {
      if (fullPathSplit.includes(pattern)) return true;
    }
    return regexPatterns.some(regex => regex.test(normalizedPath));
  }

  getFileType(stats: fs.Stats): FileType {
    switch (true) {
      case stats.isFile():
        return FileType.FILE;
      case stats.isDirectory():
        return FileType.DIRECTORY;
      case stats.isSymbolicLink():
        return FileType.SYMBOLIC_LINK;
      case stats.isSocket():
        return FileType.SOCKET;
      case stats.isFIFO():
        return FileType.FIFO;
      case stats.isCharacterDevice():
        return FileType.CHARACTER_DEVICE;
      case stats.isBlockDevice():
        return FileType.BLOCK_DEVICE;
      default:
        return FileType.UNKNOWN;
    }
  }

  getFilePermissions(stats: fs.Stats): string {
    const mode = stats.mode;
    const owner = (mode & 0o700) >> 6;
    const group = (mode & 0o070) >> 3;
    const others = mode & 0o007;
    const toRWX = (perm: number) => `${perm & 4 ? 'r' : '-'}${perm & 2 ? 'w' : '-'}${perm & 1 ? 'x' : '-'}`;
    const typePrefix = stats.isDirectory() ? 'd' : '-';
    return `${typePrefix}${toRWX(owner)}${toRWX(group)}${toRWX(others)}`;
  }

  getErrorCode(error: any, context: 'TASK' | 'OPERATION'): string {
    if (error.code) {
      switch (error.code) {
        case 'ENOENT':
          // File or directory does not exist [edge case]
          return context === 'TASK' ? 'TASK_FILE_NOT_FOUND' : 'OP_FILE_NOT_FOUND';
        case 'EACCES':
          // Permission denied
          return context === 'TASK' ? 'TASK_PERMISSION_DENIED' : 'OP_PERMISSION_DENIED';
        case 'EMFILE':
          // Too many open files [rare edge case]
          return context === 'TASK' ? 'TASK_TOO_MANY_OPEN_FILES' : 'OP_TOO_MANY_OPEN_FILES';
        case 'ENOTDIR':
          // Expected directory but found file [rare edge case]
          return context === 'TASK' ? 'TASK_NOT_A_DIRECTORY' : 'OP_NOT_A_DIRECTORY';
        case 'EISDIR':
          // Expected file but found directory [rare edge case]
          return context === 'TASK' ? 'TASK_IS_A_DIRECTORY' : 'OP_IS_A_DIRECTORY';
        case 'ENOSPC':
          // No space left on device
          return context === 'TASK' ? 'TASK_NO_SPACE_LEFT' : 'OP_NO_SPACE_LEFT';
        case 'EROFS':
          // Read-only filesystem
          return context === 'TASK' ? 'TASK_READ_ONLY_FILESYSTEM' : 'OP_READ_ONLY_FILESYSTEM';
        case 'EBUSY':
          // Resource busy (file in use) [rare edge case]
          return context === 'TASK' ? 'TASK_RESOURCE_BUSY' : 'OP_RESOURCE_BUSY';
        case 'ELOOP':
          // Too many symbolic links
          return context === 'TASK' ? 'TASK_TOO_MANY_SYMLINKS' : 'OP_TOO_MANY_SYMLINKS';
        case 'ECONNRESET':
          // Connection reset by peer
          return context === 'TASK' ? 'TASK_CONNECTION_RESET' : 'OP_CONNECTION_RESET';
        case 'ETIMEDOUT':
          // Operation timed out
          return context === 'TASK' ? 'TASK_OPERATION_TIMED_OUT' : 'OP_OPERATION_TIMED_OUT';
        case 'ENETDOWN':
          // Network is down
          return context === 'TASK' ? 'TASK_NETWORK_DOWN' : 'OP_NETWORK_DOWN';
        case 'ECONNREFUSED':
          // Connection refused
          return context === 'TASK' ? 'TASK_CONNECTION_REFUSED' : 'OP_CONNECTION_REFUSED';
        case 'EPIPE':
          // Broken pipe
          return context === 'TASK' ? 'TASK_BROKEN_PIPE' : 'OP_BROKEN_PIPE';
        case 'ENAMETOOLONG':
          // Filename too long
          return context === 'TASK' ? 'TASK_FILENAME_TOO_LONG' : 'OP_FILENAME_TOO_LONG';
        default:
          // Unknown error
          return context === 'TASK' ? 'TASK_UNKNOWN_ERROR' : 'OP_UNKNOWN_ERROR';
      }
    }
    return context === 'TASK' ? 'TASK_GENERAL_FAILURE' : 'OP_GENERAL_FAILURE';
  }
}