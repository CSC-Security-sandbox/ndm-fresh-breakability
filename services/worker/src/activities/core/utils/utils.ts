import { Cmd, JobManagerContext, TaskInfo, TaskStatus, TaskType } from "@netapp-cloud-datamigrate/jobs-lib";
import { uuid4 } from "@temporalio/workflow";
import * as fs from 'fs';
import * as crypto from "crypto";
import * as path from "path";


export const buildTask = (taskType: TaskType, jobRunId: string, jobContext:  JobManagerContext, commands: Cmd[]): TaskInfo => new TaskInfo(
  uuid4(),
  jobRunId,
  taskType,
  TaskStatus.PENDING,
  jobContext.jobConfig.workerIds[0],
  jobContext.jobConfig.sourceFileServer.pathId,
  commands,
  jobContext.jobConfig.destinationFileServer ? jobContext.jobConfig.destinationFileServer.pathId: null,
  '',
  0
)

export const isPathExists = async (path: string): Promise<boolean> => {
  try {
    await fs.promises.access(path, fs.constants.F_OK);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false; // Path does not exist
    }
  }
  return false;
}

export const isExists = async (path: string): Promise<boolean> => {
  try {
    await fs.promises.lstat(path);
    return true;
  } catch (error) {
     return false;
    }  
}


export const isNotWritable = async (filePath: string): Promise<boolean> => {
  try {
    // Single syscall: check both existence and write permissions
    await fs.promises.access(filePath, fs.constants.F_OK | fs.constants.W_OK);
    return false; // exists & writable
  } catch (err: any) {
    if (err.code === "EACCES" || err.code === "EPERM") {
      return true; // exists but not writable
    }
    return false; // doesn't exist or other reason → let caller decide
  }
};

export async function calculateChecksum(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  try{
      for await (const chunk of stream) {
        hash.update(chunk);
      }
      return hash.digest('hex');
  }finally{
    if(stream && !stream.destroyed){
      stream.destroy();
    }
  }
}

function getOptimalBufferSize(fileSize: number, maxBufferSize: number): number {
  // For very small files, use smaller buffer to avoid memory waste
  if (fileSize < 65536) return 65536; // 64KB
  if (fileSize < 512500) return 262144; // 500KB - 256KB
  // For small files, use moderate buffer
  if (fileSize < 1048576) return 1048576; // 1MB
  // For medium files, use larger buffer for better throughput
  return maxBufferSize;
}

export async function smartCopy(source:string, target:string, filesize:number, maxBufferSize :number) {
  const destDir = path.dirname(target);
  await fs.promises.mkdir(destDir, { recursive: true });
  let readStream: fs.ReadStream = null;
  let writeStream: fs.WriteStream = null;
  try{
    const bufferSize = getOptimalBufferSize(filesize, maxBufferSize);

    try {
      await fs.promises.access(source, fs.constants.R_OK);
    } catch {
      throw new Error(`Source file ${source} does not exist or is not readable`);
    }

    readStream = fs.createReadStream(source, { highWaterMark: bufferSize });
    writeStream = fs.createWriteStream(target, { flags: 'w', highWaterMark: bufferSize });
    let hash = crypto.createHash('sha256');

    const sourceCheckSum  = await new Promise((resolve, reject) => {
      let errored = false;

      readStream.on('data', (chunk) => {
        hash.update(chunk);
      });

      readStream.on('error', (err) => {
        if (!errored) {
          errored = true;
          console.error(`Error reading source file:`, err);
          reject(err);
        }
      });

      writeStream.on('error', (err) => {
        if (!errored) {
          errored = true;
          console.error(`Error writing to target file:`, err);
          reject(err);
        }
      });

      writeStream.on('finish', () => {
        // Ensure all data has been written before resolving
        resolve(hash.digest('hex'));
      });

      readStream.pipe(writeStream);
    });

    const targetCheckSum = await calculateChecksum(target);
    return {sourceChecksum: sourceCheckSum, targetChecksum: targetCheckSum};
  }catch(error){
    console.error(`Error during smartCopy from ${source} to ${target}:`, error);
    throw error;
  }finally{
    if(readStream && !readStream.destroyed){
      readStream.destroy();
    }
    if(writeStream && !writeStream.destroyed){
      writeStream.destroy();
    }
  }
  }