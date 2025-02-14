import { DMError, FileInfo, JobContextFactory, RedisUtils, TaskStats, Command } from '@netapp-cloud-datamigrate/jobs-lib';
import * as path from 'path';
import * as fs from 'fs';

import { FileEntry, FileType, ProcessFolderReadParams } from '../types/tasks';

type ProcessTaskArgs = {
  commands: Command[];
  traceId: string;
  workerId?: string;
  taskId?: string;
  sourcePath: string;
  excludeFilePatterns?: string;
  options: any
};

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}

export async function discovery(traceId: string, options: any, streamMessage: any ) {
  try {
    log(traceId, `Starting discovery`);
    const inventoryStats = await processTask({
      commands: streamMessage.commands,
      traceId,
      workerId: streamMessage?.workerId,
      taskId: streamMessage?.taskId,
      sourcePath: streamMessage.sourcePath,
      excludeFilePatterns: streamMessage?.excludeFilePatterns,
      options,
    });
    return inventoryStats;
  } catch (error) {
    log('ERROR -> ', error)
  }
}

async function processTask(args: ProcessTaskArgs) {
  const { commands, traceId, workerId, taskId, sourcePath, excludeFilePatterns, options } = args;
  if (!commands.length) return {};
  const ids = { jobRunId: traceId, workerId: workerId, taskId: taskId };
  let taskStats = undefined;
  try {
    let redisClient = await RedisUtils.getClient();
    console.log(`Redis Client: ${redisClient}`);
    if(!redisClient.isOpen) redisClient = await redisClient.connect();
    console.log(`Redis Client connect: ${redisClient}`);
    const contextProvider = JobContextFactory.getProvider('redis', redisClient);
    let jobContext = await contextProvider.getJobContext(traceId);
    await Promise.all(
      commands.map(async (cmd: any) => {
        taskStats = new TaskStats('SCAN');
        try {
          log(traceId, `Processing command: ${JSON.stringify(cmd)}`);
          const { fPath } = cmd;
          const files = await fs.readdirSync(fPath);

          console.log(
            `[${traceId}] Inventories Discovered: ${JSON.stringify(files)}`,
          );

          const inventory = await processFolderRead({
            files,
            chunkPath: fPath,
            jobRunId: ids.jobRunId,
            pathId: sourcePath,
            batchSize: options?.batchSize || 10,
            workerId: ids.workerId,
            commandId: cmd.commandId || 'test',
            excludePattern: excludeFilePatterns?.split(','),
            taskId: ids.taskId
          });
          taskStats.numFiles =
            taskStats.numFiles +
            inventory.payload?.accumulatedResult?.filter(
              (entry: any) => !entry.isDirectory,
            ).length;
          taskStats.numDirs =
            taskStats.numDirs + inventory?.payload?.unScannedPaths?.length;
          taskStats.numErrors = 0;
          log(
            traceId,
            `Processed ${inventory?.payload?.accumulatedResult?.length} files`,
          );
        } catch (error) {
          log(traceId, `Error in processing commands: ${error}`);
          if (!jobContext.errorsInfo) {
            jobContext.errorsInfo.init();
          }
          const dmError = new DMError(cmd.fPath, error);
          const id = await jobContext.appendToErrorList(dmError);
          jobContext.errorsInfo.lastId = id;
        }
      }),
    );
  } catch (error) {
    return {
      traceId: traceId,
      status: 'error',
      workerId: workerId,
      message: `Failed to process the task ${taskId}  of Job run id ${traceId} : ${error}`,
    };
  }

  return taskStats;
}

export async function processFolderRead({
  files,
  chunkPath,
  jobRunId,
  pathId,
  batchSize,
  workerId,
  commandId,
  excludePattern,
  taskId,
}: ProcessFolderReadParams) {
  const payload: any = {
    accumulatedResult: [],
    unScannedPaths: [],
  };
  const ids = { jobRunId, workerId, transactionId: '' };
  let redisClient = await RedisUtils.getClient();
  console.log(`Redis Client: ${redisClient}`);
  if(!redisClient.isOpen) redisClient = await redisClient.connect();
  console.log(`Redis Client connect: ${redisClient}`);
  const contextProvider = JobContextFactory.getProvider('redis', redisClient);
  let jobContext = await contextProvider.getJobContext(jobRunId);
  for (const file of files) {
    try{
    const fullPath = path.join(chunkPath, file);
    const lStat = await fs.promises.lstat(fullPath);
    const isDirectory = lStat.isDirectory();
    // const shouldExcludeFile = shouldExclude(fullPath, excludePattern);
    // if (shouldExcludeFile) continue;
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
      permission: getFilePermissions(lStat),
      accessTime: new Date(lStat.atime).toISOString(),
      fileType: getFileType(lStat),
      depth: fullPath.split('/').length - 2,
    };
    payload.accumulatedResult.push(entry);
    if (entry.isDirectory) {
      payload.unScannedPaths.push(entry.path);
    }
    log(jobRunId, `Processed ${payload.accumulatedResult.length} files`);
  }catch(error){
    if (!jobContext.errorsInfo) {
      jobContext.errorsInfo.init();
    }
    const dmError = new DMError(file, error);
    const id = await jobContext.appendToErrorList(dmError);
    jobContext.errorsInfo.lastId = id;
    // client.set(jobRunId, jobContext.serialize());
    return {
      traceId: jobRunId,
      status: 'error',
      hostname: payload.hostname,
      workerId: workerId,
      message: `Failed to Discover for job run id ${jobRunId}: ${error}`,
    };
  }
  }
  const fileStatsArray: FileInfo[] = payload.accumulatedResult.map(
    (entry: any) => {
      return new FileInfo(
        entry.fileName,
        entry.path,
        entry.parentPath,
        entry.isDirectory,
        parseInt(entry.uid),
        parseInt(entry.gid),
        entry.fileSize,
        !entry.isDirectory,
        new Date(entry.birthTime),
        new Date(entry.modifiedTime),
        new Date(entry.accessTime),
        entry.extension,
        entry.permission,
        entry.fileType,
        entry.depth,
      );
    },
  );
  fileStatsArray.forEach(async (fileStats) => {
    if (fileStats.isDirectory) {
      if (!jobContext.dirsInfo) {
        jobContext.dirsInfo.init();
      }
     const id=  await jobContext.appendToDirList(fileStats);
      jobContext.dirsInfo.lastId = id;
      jobContext.dirsInfo.numMessages++;
      log(jobRunId, `***************Appending to dir list***************`);
    } else {
      if (!jobContext.filesInfo) {
        jobContext.filesInfo.init();
      }
      const id = await jobContext.appendToFileList(fileStats);
       jobContext.filesInfo.lastId = id;
       jobContext.filesInfo.numMessages++;
      log(jobRunId, `***************Appending to file list***************`);
    }
  });
  // client.set(jobRunId, jobContext.serialize());
  return { payload };
}

export function shouldExclude(
  fullPath: string,
  excludePatterns: string[],
): boolean {
  if (!excludePatterns.length) return false;
  const normalizedPath = fullPath.endsWith('/') ? fullPath : `${fullPath}/`;
  const regexPatterns = excludePatterns.map((pattern) => {
    const escapedPattern = pattern.replace(/[-\/\\^$+?.()|[\]{}]/g, '\\$&');
    const regexString = escapedPattern.replace(/\*/g, '.*');
    return new RegExp(`^${regexString}`, 'i');
  });
  const fullPathSplit = fullPath.split('/');
  for (let pattern of excludePatterns) {
    if (fullPathSplit.includes(pattern)) return true;
  }
  return regexPatterns.some((regex) => regex.test(normalizedPath));
}

export function getFileType(stats: fs.Stats): FileType {
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

export function getFilePermissions(stats: fs.Stats): string {
  const mode = stats.mode;
  const owner = (mode & 0o700) >> 6;
  const group = (mode & 0o070) >> 3;
  const others = mode & 0o007;
  const toRWX = (perm: number) =>
    `${perm & 4 ? 'r' : '-'}${perm & 2 ? 'w' : '-'}${perm & 1 ? 'x' : '-'}`;
  const typePrefix = stats.isDirectory() ? 'd' : '-';
  return `${typePrefix}${toRWX(owner)}${toRWX(group)}${toRWX(others)}`;
}
