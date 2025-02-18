import { join } from 'path';
// import * as workerpool from 'workerpool';
import { DiscoveryPayload, FileEntry, FileType, MessageType, ProcessFolderReadParams, WorkerMessage } from '../types/tasks';
import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';
import * as path from 'path';
import * as fs from 'fs';
import { JobContext } from '@netapp-cloud-datamigrate/jobs-lib';
import { OperationStatus, TaskStatus } from './enums';

@Injectable()
export class DiscoveryScanActivity {
  constructor(
    private readonly redisService: RedisService,
  ) {
  }

  async scanActivity(payload: DiscoveryPayload, traceId: string): Promise<any> {
    const jobContext: JobContext = await this.redisService.getJobContext(traceId);
    payload.data.status=TaskStatus.Running
    payload.data.commands.map((cmd: any) => {
      cmd.status = OperationStatus.IN_PROCESS;
    });
    const id = await jobContext.appendToUpdatedTaskList(payload.data);
    jobContext.updatedTaskInfo.lastId = id;
    await  this.redisService.setJobContext(traceId, jobContext);
    return await this.discovery(payload, jobContext);
  }

  private async processInventory(inventory, jobContext: JobContext): Promise<any> {
    try {
      const result = await Promise.all(
        inventory.map(async (item) => {
          if (item.isDirectory) {
            const id = await jobContext.appendToDirList(item);
            jobContext.dirsInfo.lastId = id;
            // jobContext.dirsInfo.numMessages++;
          }
          const id = await jobContext.appendToFileList(item);
          jobContext.filesInfo.lastId = id;
          // jobContext.filesInfo.numMessages++;
        })
      );
      return result;
    } catch (error) {
      console.error("Error processing inventory:", error);
      throw error;
    }
  }

  async discovery(data: DiscoveryPayload, jobContext: JobContext, batchSize: number = 1000): Promise<any> {
    const inventoryData = [];
    if (!data) return;
    const ids = { jobRunId: data.data.jobRunId, workerId: data.data.workerId, transactionId: '', taskId: data.data.id, traceId: data.data.jobRunId };
    await Promise.all(data.data.commands.map(async cmd => {
      try {
        const { fPath } = cmd;
        const files = await fs.promises.readdir(fPath);
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
          jobContext
        });
        inventoryData.push(...accumulatedResult);
        if (inventoryData.length >= batchSize) {
          const batch = inventoryData.splice(0, batchSize);
          await this.processInventory(batch, jobContext)
        }
        return { ...cmd, ops: { 0: { ...cmd.ops[0], status: TaskStatus.Completed } } };
      } catch (error) {
        return { ...cmd, ops: { 0: { ...cmd.ops[0], status: TaskStatus.Errored} } };
      }
    }));
    await this.processInventory(inventoryData, jobContext)
    data.data.status = TaskStatus.Completed;
    const taskId = await jobContext.appendToUpdatedTaskList(data.data);
    jobContext.updatedTaskInfo.lastId = taskId;
    this.redisService.setJobContext(data.data.jobRunId, jobContext);
    return 'success';
  }

  async processFolderRead({
    files,
    chunkPath,
    jobRunId,
    pathId,
    batchSize,
    workerId,
    commandId,
    excludePattern,
    taskId,
    jobContext
  }: ProcessFolderReadParams) {
    const accumulatedResult = [];
    const ids = { jobRunId, workerId, transactionId: '' }
    for (const file of files) {
      const fullPath = path.join(chunkPath, file);
      const lStat = await fs.promises.lstat(fullPath);
      const isDirectory = lStat.isDirectory();
      const shouldExcludeFile = this.shouldExclude(fullPath, excludePattern);
      if (shouldExcludeFile) continue;
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
      };
      accumulatedResult.push(entry);
      if (accumulatedResult.length >= batchSize) {
        const batch = accumulatedResult.splice(0, batchSize);
        await this.processInventory(batch, jobContext)
      }
    }
    return { accumulatedResult };
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
}