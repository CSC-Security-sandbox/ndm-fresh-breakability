import * as fs from "fs";
import * as crypto from "crypto";
import * as path from 'path';
import { Command, DMError, FileInfo, JobContext, JobContextFactory, RedisUtils, Task, TaskStatsType, TaskStatus, TaskType } from "@netapp-cloud-datamigrate/jobs-lib";
import { GetJobConnectionInput, GetJobConnectionOutput } from "./utils.types";
import { uuid4 } from "@temporalio/workflow";
import { FileType } from "../types/tasks";

export const getChecksum = (filePath: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(filePath);

        stream.on("data", (data: Buffer) => hash.update(data));
        stream.on("end", () => resolve(hash.digest("hex")));
        stream.on("error", reject);
    });
};

export const removePrefix = (str: string, prefix: string): string => 
    str.startsWith(prefix) ? str.slice(prefix.length, 1000) : str;

export const getFilePermissions = (stats: fs.Stats) : string =>{
    const mode = stats.mode;
    const owner = (mode & 0o700) >> 6;
    const group = (mode & 0o070) >> 3;
    const others = mode & 0o007;
    const toRWX = (perm: number) => `${perm & 4 ? 'r' : '-'}${perm & 2 ? 'w' : '-'}${perm & 1 ? 'x' : '-'}`;
    const typePrefix = stats.isDirectory() ? 'd' : '-';
    return `${typePrefix}${toRWX(owner)}${toRWX(group)}${toRWX(others)}`;
}

export const shouldExclude = ( fullPath: string, excludePatterns: string[] ): boolean =>{
    if (!excludePatterns.length) return false;
    const normalizedPath = fullPath.endsWith('/') ? fullPath : `${fullPath}/`;
    const regexPatterns = excludePatterns.map((pattern) => {
      const escapedPattern = pattern.replace(/[-\/\\^$+?.()|[\]{}]/g, '\\$&');
      const regexString = escapedPattern.replace(/\*/g, '.*');
      return new RegExp(`^${regexString}`, 'i');
    });
    const fullPathSplit = fullPath.split('/');
    for (let pattern of excludePatterns) 
      if (fullPathSplit.includes(pattern)) return true;
    return regexPatterns.some((regex) => regex.test(normalizedPath));
}
  

export const getJobConnection = async ({jobRunId}: GetJobConnectionInput): Promise<GetJobConnectionOutput> => {
    const redisClient = await RedisUtils.getClient();
    if (!redisClient.isOpen) {
        await redisClient.connect();
        console.log(`job run ${jobRunId}, Connected to Redis client.`);
    }
    const contextProvider = JobContextFactory.getProvider('redis', redisClient);
    const jobContext = await contextProvider.getJobContext(jobRunId);
    return {jobContext, connectionClient: redisClient}
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

export const getFileInfo = async (name: string, fullFilePath:string, relativePath: string, 
  checksums?:{
    sourceChecksum?: string,
    targetChecksum?:string
  }
): Promise<any>  => {
    const lStat = await fs.promises.lstat(fullFilePath);
    const obj = new FileInfo(
        name,
        relativePath,
        relativePath,
        lStat.isDirectory(),
        lStat.uid,
        lStat.gid,
        lStat.size,
        !lStat.isDirectory(),
        lStat.birthtime,
        lStat.mtime,
        lStat.atime,
        path.extname(fullFilePath),
        getFilePermissions(lStat),
        getFileType(lStat),
        relativePath.split('/').length - 2,
      );
    return {
      ...obj,
      uid: lStat.uid.toString(),
      gid: lStat.gid.toString(),
      fileSize: lStat.size,
      blocks: lStat.blocks,
      modifiedTime: new Date(lStat.mtime).toISOString(),
      birthTime: new Date(lStat.birthtime).toISOString(),
      accessTime: new Date(lStat.atime).toISOString(),
      ...checksums
    }
}


export const buildTask = (taskType: TaskType, jobRunId: string, jobContext: JobContext, commands: Command[]): Task => new Task(
  uuid4(), jobRunId, taskType, TaskStatus.PENDING, jobContext.jobConfig.workerIds[0],
  `${jobContext.jobConfig.sourceFileServer.workingDirectory}/${jobRunId}/${jobContext.jobConfig.sourceFileServer.pathId}`,
  jobContext.jobConfig.sourceFileServer.pathId,
  commands,
  jobContext.jobConfig.destinationFileServer ? `${jobContext.jobConfig.destinationFileServer.workingDirectory}/${jobRunId}/${jobContext.jobConfig.destinationFileServer.pathId}` : null,
  jobContext.jobConfig.destinationFileServer ? jobContext.jobConfig.destinationFileServer.pathId: null,
  ''
)

export const generateDummyFileEntry: FileInfo = new FileInfo("LAST_FILE", "", "", false, 1001, 1001, 2048, true, new Date(), new Date(), new Date(), "", "", "", 0);

export const getErrorCode = (error: any, context: 'TASK' | 'OPERATION'): string =>{
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

export const formatDate = (date: Date): string => {
  const pad = (n: number) => (n < 10 ? `0${n}` : n);
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
};

export const dmError = (type: 'TASK' | 'OPERATION', correlationId: string, error?: Error, file? : {name:  string, path: string}, customError ?: {errorCode: string[], message: string}) => {
 
  switch (type) {
    case 'OPERATION': {
      const errorCode = getErrorCode(error, type);
      return new DMError(null, { operationId: correlationId, errorCode, errorMessage: error.message, errorFiles: { fileName: file.name, filePath: file.path } })
    }
    case 'TASK': {
      const errorCode = customError?.errorCode ?  customError.errorCode.map(code => getErrorCode({code}, 'TASK')).join('\n') : ''
      return new DMError({ taskId: correlationId, errorCode, errorMessage: customError.message })
    }
    default: {
      const errorCode = getErrorCode(error, type);
      return new DMError({ taskId: correlationId, errorCode, errorMessage: error.message })
    }
  }
}



