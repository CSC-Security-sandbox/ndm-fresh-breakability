import * as fs from "fs";
import * as crypto from "crypto";
import * as path from 'path';
import { promises as fsPromises } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Command, DMError, ErrorType, FileInfo, JobContext, JobContextFactory, JobManagerContext, RedisUtils, Task, TaskStatus, TaskType, Protocol, Cmd, ItemInfo, TaskInfo, CommandStatus} from "@netapp-cloud-datamigrate/jobs-lib";
import { ACL, ExcludeForDelete, ExcludeOrSkipParams, getFileInfoInput, GetJobConnectionInput, GetJobConnectionOutput, Operation, Origin } from "./utils.types";
import { isPathExists } from "../core/utils/utils";
import { uuid4 } from "@temporalio/workflow";
import { FileType } from "../types/tasks";
import { execSync } from "child_process";
import { E8Dot3CollisionError, FatalError } from "../../errors/errors.types";

const execAsync = promisify(exec);

const statsForLog = (file?: fs.Stats) => {
  if (!file) return undefined;
  const iso = (d?: Date) => (d instanceof Date ? d.toISOString() : undefined);
  return {
    size: file.size,
    mtime: iso(file.mtime),
    atime: iso(file.atime),
    ctime: iso(file.ctime),
    mode: file.mode,
    uid: file.uid,
    gid: file.gid,
    ino: file.ino,
    isDirectory: typeof file.isDirectory === 'function' ? file.isDirectory() : undefined,
    isFile: typeof file.isFile === 'function' ? file.isFile() : undefined,
    isSymbolicLink: typeof file.isSymbolicLink === 'function' ? file.isSymbolicLink() : undefined,
  };
};

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
    str.startsWith(prefix) ? str.slice(prefix.length) : str;

export const getFilePermissions = (stats: fs.Stats, isDirectory: boolean) : string =>{
    const mode = stats.mode;
    const owner = (mode & 0o700) >> 6;
    const group = (mode & 0o070) >> 3;
    const others = mode & 0o007;
    const toRWX = (perm: number) => `${perm & 4 ? 'r' : '-'}${perm & 2 ? 'w' : '-'}${perm & 1 ? 'x' : '-'}`;
    const typePrefix = isDirectory ? 'd' : '-';
    return `${typePrefix}${toRWX(owner)}${toRWX(group)}${toRWX(others)}`;
}

export const shouldExclude = ( fullPath: string, excludePatterns: string[] ): boolean =>{
    if (!excludePatterns.length) return false;
    excludePatterns = excludePatterns.map((pattern) => pattern.trim()).filter((pattern) => pattern.length > 0);
    const normalizedPath = fullPath.replace(/\\/g, '/').replace(/\/?$/, '/');
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

export const shouldSkipFile = (stats: fs.Stats, skipTime: string, jobType: string): boolean => {
  if (!skipTime) return false;
  if(jobType !== 'MIGRATE') return false;
  const skipTimeSplit = skipTime.split('-');
  if (skipTimeSplit.length !== 2) return false;
  const skipValue = parseInt(skipTimeSplit[0], 10);
  const skipType = skipTimeSplit[1]?.toUpperCase();
  if (isNaN(skipValue) || skipValue <= 0) return false;
  const currentTime = new Date();
  const fileTime = stats.mtime;
  const diff = currentTime.getTime() - fileTime.getTime();
  switch (skipType) {
    case 'M':
      return diff < skipValue * 60 * 1000;
    case 'H':
      return diff < skipValue * 60 * 60 * 1000;
    case 'D':
      return diff < skipValue * 24 * 60 * 60 * 1000;
    default:
      return false;
  }
};

export const shouldExcludeOlderThan = (stats: fs.Stats, olderThan: Date): boolean => {
  if (!olderThan) return false;
  return stats.mtime < olderThan;
}

export const shouldExcludeOrSkip = ({ fullPath, stats, excludePatterns, skipTime, olderThan, jobType }: ExcludeOrSkipParams): boolean => (shouldExclude(fullPath, excludePatterns) || shouldSkipFile(stats, skipTime, jobType) || shouldExcludeOlderThan(stats, olderThan));

/** Returns 'excluded' | 'skipped' | null so callers can distinguish and record paths. */
export const getExcludeOrSkipReason = ({ fullPath, stats, excludePatterns, skipTime, olderThan, jobType }: ExcludeOrSkipParams): 'excluded' | 'skipped' | null => {
  if (shouldExclude(fullPath, excludePatterns) || shouldExcludeOlderThan(stats, olderThan)) return 'excluded';
  if (shouldSkipFile(stats, skipTime, jobType)) return 'skipped';
  return null;
};

export const shouldExcludeForDelete = ({ fullPath, excludePatterns }: ExcludeForDelete): boolean => (shouldExclude(fullPath, excludePatterns));

export const checkCaseSensitiveConflict = async (jobType: string, itemName: string, lowerCaseSourceData: Set<string>, relativeSourcePath: string, sourceContentPath: string, command: Cmd, jobContext: JobManagerContext, lowerCaseTargetData?: Set<string>, targetContent?: Set<string>, isDirectory?: boolean): Promise<boolean> => {
  const lowerCaseFileName = itemName.toLowerCase();
  if (lowerCaseSourceData.has(lowerCaseFileName) || (lowerCaseTargetData?.has(lowerCaseFileName) && !targetContent?.has(itemName))) {
    const isDiscovery = jobType === "DISCOVER";
    const itemType = isDirectory ? 'Directory' : 'File';
    const errorMessage = isDiscovery ? "Directory contents not discovered: Another directory with same name but different case exists" : `${itemType} not migrated: Another ${itemType.toLowerCase()} with same name but different case exists`;
    const error = new Error(errorMessage) as Error & {code: "EEXIST"};
    const origin = isDiscovery ? Origin.SOURCE : Origin.DESTINATION;
    const operationName: Operation = isDiscovery ? Operation.READ_DIR : Operation.COPY_CONTENT;
    const dmErr = dmError("OPERATION", origin, operationName, ErrorType.TRANSIENT_ERROR, command.id, error, {name: relativeSourcePath, path: sourceContentPath});
    await jobContext.publishToErrorStream(dmErr);
    return true;
  }
  lowerCaseSourceData.add(lowerCaseFileName);
  return false;
}

export function getFileType(stats: fs.Stats, isDirectory:boolean): FileType {
  // TODO: add file_stream and dir_stream details also in this 
    switch (true) {
      case isDirectory:
        return FileType.DIRECTORY;
      case stats.isSymbolicLink():
        return FileType.SYMBOLIC_LINK;
      case stats.isFile():
        return FileType.FILE;      
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


  export const getFileInfo = async ({name, fullFilePath, relativePath, checksums, getID}: getFileInfoInput): Promise<any>  => {
    const lStat = await fs.promises.lstat(fullFilePath);
    const isDirectory:boolean = lStat.isDirectory();
    let sid = undefined
    if(getID && process.platform == 'win32' && lStat.isFile())
      sid = getSID(fullFilePath);
    const obj = new FileInfo(
        name,
        relativePath,
        relativePath,
        isDirectory,
        lStat.size,
        !isDirectory,
        lStat.birthtime,
        lStat.mtime,
        lStat.atime,
        path.extname(fullFilePath),
        getFilePermissions(lStat, isDirectory),
        getFileType(lStat, isDirectory),
        relativePath.split('/').length - 2,
        lStat.uid,
        lStat.gid,
      );
    return {
      ...obj,
      ...checksums,
      sid
    }
}

export const buildTask = (taskType: TaskType, jobRunId: string, jobContext: JobContext | JobManagerContext, commands: Command[]): Task => new Task(
  uuid4(), jobRunId, taskType, TaskStatus.PENDING, jobContext.jobConfig.workerIds[0],
  basePrefix(jobRunId, jobContext.jobConfig.sourceFileServer.pathId, jobContext.jobConfig.sourceDirectoryPath),
  jobContext.jobConfig.sourceFileServer.pathId,
  commands,
  jobContext.jobConfig.destinationFileServer ?  basePrefix(jobRunId, jobContext.jobConfig.destinationFileServer.pathId, jobContext.jobConfig.destinationDirectoryPath) : null,
  jobContext.jobConfig.destinationFileServer ? jobContext.jobConfig.destinationFileServer.pathId: null,
  ''
)

export const isContentUpdate = (sFile: fs.Stats, dFile?: fs.Stats, fileName = 'unknown'): boolean => {
  const isUpdated = !dFile || (sFile.size !== dFile.size) || (sFile.mtime.toISOString() !== dFile.mtime.toISOString());
  console.debug('[isContentUpdate]', {
    file: fileName,
    sourceStats: statsForLog(sFile),
    destinationStats: statsForLog(dFile),
    result: isUpdated,
  });
  return isUpdated;
};
 

export const isMetaUpdated = (sFile: fs.Stats, dFile?: fs.Stats, toleranceMs = 1000, fileName = 'unknown'): boolean => {
  const sourceCtimeMs = sFile.ctimeMs;
  const destinationCtimeMs = dFile?.ctimeMs;
  const thresholdCtimeMs = destinationCtimeMs !== undefined ? destinationCtimeMs + toleranceMs : undefined;
  const isUpdated = !dFile || (thresholdCtimeMs !== undefined && sourceCtimeMs > thresholdCtimeMs);
  console.debug('[isMetaUpdated]', {
    file: fileName,
    sourceStats: statsForLog(sFile),
    destinationStats: statsForLog(dFile),
    sourceCtimeMs,
    destinationCtimeMs,
    thresholdCtimeMs,
    toleranceMs,
    result: isUpdated,
  });
  return isUpdated;
};

export const generateDummyFileEntry: FileInfo = new FileInfo("LAST_FILE", "", "", false,  2048, true, new Date(), new Date(), new Date(), "", "", "", 0, 1001, 1001);
export const generateDummyItemEntry: ItemInfo = new ItemInfo(
  "LAST_FILE", // fileName
  false, // isDirectory
  false, // isSymbolicLink
  0, // depth
  "", // extension
  "file", // fileType
  {
    birthTime: new Date(),
    modifiedTime: new Date(),
    accessTime: new Date(),
    permission: "rwxr-xr-x",  // permission
    checksum: "dummy-checksum-source" // checksum
  }, // sourceMeta
  {
    birthTime: new Date(),
    modifiedTime: new Date(),
    accessTime: new Date(),
    permission: "rwxr-xr-x", // permission  
    checksum: "dummy-checksum-target" // checksum
  }, // targeMeta
  2048, // size
  0,
  false,
  null // checksumTime
);

export const generateDummyTaskEntry: Task = new Task('8840625a-b818-42a8-98c8-5c05aaa19106', '', TaskType.MIGRATE, TaskStatus.ERRORED, '', '', '', [], '', '', '');
export const generateDummyTaskInfoEntry: TaskInfo = new TaskInfo(
  '8840625a-b818-42a8-98c8-5c05aaa19106', 
  '',
  TaskType.MIGRATE,
  TaskStatus.ERRORED, 
  'worker-12345',
  'sourcePathId-12345',
  [],
  'destinationPathId-12345',
);

export const generateDummyErrorEntry: DMError = new DMError({ taskId: '8840625a-b818-42a8-98c8-5c05aaa19106', errorCode: '', errorMessage: '', errorType: ErrorType.FATAL_ERROR, taskType: '' });

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
      case 'EIO':
          // Filename too long
          return context === 'TASK' ? 'TASK_SERVER_DISCONNECTED' : 'OP_SERVER_DISCONNECTED';
      case 'E8DOT3_COLLISION':
        // 8.3 short filename collision
        return context === 'TASK' ? 'TASK_8DOT3_COLLISION' : 'OP_8DOT3_COLLISION';
      case 'EEXIST':
          // Duplicate in terms of case (Isilon SMB)
          return context === 'TASK' ? 'TASK_CASE_CONFLICT' : 'OP_CASE_CONFLICT';
      case 'ETRAILSPACE':
          // Filename contains trailing spaces
          return context === 'TASK' ? 'TASK_TRAILING_SPACE' : 'OP_TRAILING_SPACE';
      case 'PERM_STAMP_CTIME_CONFLICT':
        // Explicit metadata stamp race/conflict simulation code
        return 'PERM_STAMP_CTIME_CONFLICT';
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

export const dmError = (type: 'TASK' | 'OPERATION', origin :Origin, operationName: Operation , errorType: ErrorType, correlationId: string, error?: any, file? : {name:  string, path: string}, customError ?: {errorCode: string[], message: string}) => {
  if(error) {
    // Check errno numbers when error.code might be "Unknown system error"
    if (hasFileServerDownErrorNo(error.errno)) {
      error.code = 'EIO'; // Standardize code for known error
    }
    
    // Check error.code for standard error codes
    if(error.code) {
      // Check for transient errors
      if( isTransientError(error.code)) errorType = ErrorType.TRANSIENT_ERROR;
        // Check for fatal errors (cancel activity)
      if(origin === Origin.SOURCE && isSourceFatalError(error.code)) errorType = ErrorType.FATAL_ERROR;
      if(origin === Origin.DESTINATION && isFatalError(error.code)) errorType = ErrorType.FATAL_ERROR;

    }
  }

  switch (type) {
    case 'OPERATION': {
      const errorCode = getErrorCode(error, type);
      return new DMError(null, { operationId: correlationId, origin, operationName, errorCode, errorMessage: error.message, errorFiles: { fileName: file.name, filePath: file.path }, errorType })
    }
    case 'TASK': {
      const errorCode = customError?.errorCode ?  customError.errorCode.map(code => getErrorCode({code}, 'TASK')).join('\n') : ''
      return new DMError({ taskId: correlationId, errorCode, errorMessage: customError.message , errorType})
    }
    default: {
      const errorCode = getErrorCode(error, type);
      return new DMError({ taskId: correlationId,  errorCode, errorMessage: error.message , errorType})
    }
  }
}

export const basePrefix = (jobRunId: string, pathId: string, directoryPath?: string): string => {
  const dirPath = directoryPath || '';
  if(process.platform === 'win32') {
    const basePath = `${process.env.BASE_WORKING_PATH}\\${jobRunId}\\${pathId}`;
    return dirPath ? `${basePath}\\${dirPath.replace(/^\/+/, '').replace(/\//g, '\\')}` : basePath;
  }
  const basePath = `${process.env.BASE_WORKING_PATH}/${jobRunId}/${pathId}`;
  return dirPath ? `${basePath}/${dirPath.replace(/^\/+/, '')}` : basePath;
}

const SOURCE_FATAL_CODE = new Set<string>(['EACCES', 'ENOSPC', 'ECONNRESET', 'ETIMEDOUT', 'ENETDOWN', 'ECONNREFUSED'])
const FATAL_CODE = new Set<string>(['EACCES', 'ENOSPC', 'EROFS', 'ECONNRESET', 'ETIMEDOUT', 'ENETDOWN', 'ECONNREFUSED']);

// Transient errors that should not be retried
const TRANSIENT_CODE = new Set<string>(['E8DOT3_COLLISION']);

// File server down errno numbers (negative values as reported by Node.js)
const FileServerDownErrorNo = new Set<number>([-116, -96]); // ESTALE, EADDRNOTAVAIL

export const isSourceFatalError = (code :string) => code && SOURCE_FATAL_CODE.has(code)
export const isFatalError = (code :string) => code && FATAL_CODE.has(code)
export const isTransientError = (code :string) => code && TRANSIENT_CODE.has(code)
export const hasFileServerDownErrorNo = (errno: number) => errno && FileServerDownErrorNo.has(errno)

export const getServerInfoFromPath = (sourcePath: string, jobContext: JobContext): { protocol: Protocol[], server: string } => {
  try {
    const sourceConfig = jobContext.jobConfig.sourceFileServer;
    const protocol = sourceConfig?.protocols ?? [];
    const server = `${sourceConfig.hostname}${sourceConfig.path || ''}`;

    return { protocol, server };
  } catch (err) {
    return { protocol: [], server: sourcePath };
  }
}

export const extractTypes = (data: Protocol[]) => {
  return data
    .map((item) => item.type)
    .filter(type => type !== undefined)
    .join(',');
}

export const createServerDownErrorMessage = (error: any, serverInfo: { protocol: Protocol[], server: string }): string => {
  const types = extractTypes(serverInfo.protocol);
  const baseMessage = `${types ? types + ' ' : ''}server unreachable: ${serverInfo.server}`;
  const errorDetails = error?.code ? ` (Error: ${error.code})` : ` (${error?.message || 'Unknown error'})`;

  return baseMessage + errorDetails;
}

export const getSID = (filePath: string) => {
    const getSIDCommand= `powershell.exe -Command "(Get-Acl '${filePath}').Owner"`;
    return execSync(getSIDCommand, { encoding: "utf-8" }).trim();
}


export const getUserACLs = (line: string, path:string): ACL[] => {
  if (!line || !path) return [];
  const lines: string[] = line.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const aclLines: string[] = [];

  const firstLine = lines[0];
  if (firstLine.includes(path)) {
    const permissions = firstLine.slice(path.length, firstLine.length).trim()
    aclLines.push(permissions); 
  }

  aclLines.push(...lines.slice(1));

  return aclLines
    .map(acl => {
      const match = acl.match(/^(.+?):\s*(.*)$/);
      if (!match) return null;

      const user = match[1].trim();
      const permsRaw = match[2].trim();

      const permsMatch = permsRaw.match(/\(*[A-Z]+\)*$/)
      if (!permsMatch || permsMatch.length === 0 ||permsRaw.includes('(I)')) return null;
      return { user, permissions: permsRaw}; 
    })
    .filter((item): item is ACL => item !== null);
};


export const  calculateCommandHash = (commands: Cmd[]): string => {
  const commandIds = commands.map(cmd => cmd.id);
  commandIds.sort(); // Sort to ensure consistent order
  const concatenatedIds = commandIds.join(',');
  return crypto.createHash('sha256').update(concatenatedIds).digest('hex');

}

/**
 * Extracts scan settings from job context configuration.
 * Shared utility used by scan and retry activities.
 *
 * @param jobContext - The job context containing job configuration
 * @returns Object with skipFile and excludePatterns
 */
export const getScanSettings = (jobContext: JobManagerContext) => {
  return {
    skipFile: jobContext.jobConfig.options?.skipsFilesModifiedInLast ?? '',
    excludePatterns: jobContext.jobConfig.options?.excludeFilePattern
      ? jobContext.jobConfig.options.excludeFilePattern.split(",")
      : []
  };
};
