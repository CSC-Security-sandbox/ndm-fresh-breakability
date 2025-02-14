import { join } from 'path';
import * as workerpool from 'workerpool';
import { DiscoveryPayload, FileEntry, FileType, MessageType, ProcessFolderReadParams, WorkerMessage } from '../types/tasks';
import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';
import * as path from 'path';
import * as fs from 'fs';
import { JobContext } from '@netapp-cloud-datamigrate/jobs-lib';

@Injectable()
export class WorkerService {
  private availableDiscoveryThreads = 5;
  private readonly pool: workerpool.Pool;

  constructor(
    private readonly redisService: RedisService,
  ) {
    this.pool = workerpool.pool(join(__dirname, 'childprocess/scan.childprocess.js'), {
      maxWorkers: this.availableDiscoveryThreads,
    });
  }

  async assignTasksToWorkerThread(payload: DiscoveryPayload, traceId: string): Promise<any> {
    // return new Promise<any>((resolve, reject) => {
    //   let isCompleted = false;
    //   this.pool.exec('discovery', [{ data: payload.data }], {
    //     on: async (message: WorkerMessage) => {
    //       const jobContext = await this.redisService.getJobContext(traceId);
    //       await this.dispatch(message, jobContext);
    //       if (message.type === MessageType.ScanCompleted && !isCompleted) {
    //         isCompleted = true;
    //         resolve({ status: 'success' });
    //       }
    //     }
    //   })
    //   .catch((error: Error) => {
    //     console.error(`Error executing worker task: ${error.message}`);
    //     reject(error);
    //   });
    // });
    const jobContext: JobContext = await this.redisService.getJobContext(traceId);
    return await this.discovery(payload, jobContext);
  }

  private async dispatch(message: WorkerMessage, jobContext): Promise<void> {
    try {
      if (message.type === MessageType.ProcessInventory) {
        message.inventory.forEach(async (i) => {
          if (i.isDirectory) {
            const id = await jobContext.appendToDirList(i);
            jobContext.dirsInfo.lastId = id;
            jobContext.dirsInfo.numMessages++;
          } else {

            const id = await jobContext.appendToFileList(i);
            jobContext.filesInfo.lastId = id;
            jobContext.filesInfo.numMessages++;
          }
        })
      }
    } catch (error) {
      console.error("THIS IS NOT WHAT I WANT -> ", error);
    }
  }

  private async processInventory(inventory, jobContext: JobContext): Promise<any> {
    try {
      const result = await Promise.all(
        inventory.map(async (item) => {
          if (item.isDirectory) {
            const id = await jobContext.appendToDirList(item);
            jobContext.dirsInfo.lastId = id;
            jobContext.dirsInfo.numMessages++;
          } else {
            const id = await jobContext.appendToFileList(item);
            jobContext.filesInfo.lastId = id;
            jobContext.filesInfo.numMessages++;
          }
        })
      );
      return result;
    } catch (error) {
      console.error("Error processing inventory:", error);
      throw error;
    }
  }

  async discovery(data: DiscoveryPayload, jobContext: JobContext, batchSize: number = 100): Promise<any> {
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
          taskId: ids.taskId
        });
        inventoryData.push(...accumulatedResult);
        if (inventoryData.length >= batchSize) {
          const batch = inventoryData.splice(0, batchSize);
          await this.processInventory(batch, jobContext)
        }
        return { ...cmd, ops: { 0: { ...cmd.ops[0], status: 'COMPLETED' } } };
      } catch (error) {
        return { ...cmd, ops: { 0: { ...cmd.ops[0], status: 'ERROR' } } };
      }
    }));
    await this.processInventory(inventoryData, jobContext)
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
    taskId
  }: ProcessFolderReadParams) {
    const accumulatedResult = [];
    const unScannedPaths = [];
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
      if (entry.isDirectory) {
        unScannedPaths.push(entry.path);
        if (unScannedPaths.length >= batchSize) {
          const batch = unScannedPaths.splice(0, batchSize);
          workerpool.workerEmit({ type: MessageType.UnScannedData, unscanned: { ...ids, paths: batch } });
        }
      }
      if (accumulatedResult.length >= batchSize) {
        const batch = accumulatedResult.splice(0, batchSize);
        workerpool.workerEmit({ ...ids, inventory: batch, type: MessageType.ProcessInventory });
      }
    }
    if (unScannedPaths.length) {
      workerpool.workerEmit({ type: MessageType.UnScannedData, unscanned: { ...ids, paths: unScannedPaths } });
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