import * as fs from "fs";
import * as crypto from "crypto";
import * as path from 'path';
import { Command, FileInfo, JobContext, JobContextFactory, RedisUtils, Task, TaskStatsType } from "@netapp-cloud-datamigrate/jobs-lib";
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

export const getFileInfo = async (name: string, fullFilePath:string, relativePath: string): Promise<any>  => {
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
    }
}


export const buildTask = (taskType: 'SCAN' | 'MIGRATE', jobRunId: string, jobContext: JobContext, commands: Command[]): Task => new Task(
  uuid4(), jobRunId, taskType, 'PENDING', jobContext.jobConfig.workerIds[0],
  `${jobContext.jobConfig.sourceFileServer.workingDirectory}/${jobRunId}/${jobContext.jobConfig.sourceFileServer.pathId}`,
  jobContext.jobConfig.sourceFileServer.pathId,
  commands,
  `${jobContext.jobConfig.destinationFileServer.workingDirectory}/${jobRunId}/${jobContext.jobConfig.destinationFileServer.pathId}`,
  jobContext.jobConfig.destinationFileServer.pathId,
  ''
)

export const generateDummyFileEntry: FileInfo = new FileInfo("LAST_FILE", "", "", false, 1001, 1001, 2048, true, new Date(), new Date(), new Date(), "", "", "", 0);