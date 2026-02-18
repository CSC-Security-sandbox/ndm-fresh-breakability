import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { createDirectory } from "../activities/utils/directory.utils";
import { E8Dot3CollisionError } from "../errors/errors.types";
import { WorkerThreadInput, WorkerThreadOutput } from "./worker.thread.type";
import { WINDOWS } from "../config/app.config";
const { parentPort, workerData } = require('worker_threads');

console.log(`Worker Thread - Starting Worker Thread  ${workerData?.threadNumber} for operationBand: ${workerData?.operationBand}`); 

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

/**
 * Determines the appropriate write stream flags for a Windows tilde file.
 * Checks if file exists to prevent EEXIST errors on 8.3 short name files.
 * 
 * @param target - The target file path (must be a Windows tilde file)
 * @returns 'w' if file exists (overwrite), 'wx' if file doesn't exist (exclusive creation)
 */
async function getWriteStreamFlags(target: string): Promise<string> {
  if (process.platform === WINDOWS && path.basename(target).includes('~')) {
      try {
        // If realpath succeeds, file exists - use 'w' flag to overwrite
        await fs.promises.realpath(target);
        return 'w';
      } catch (error) {
        // If realpath fails with ENOENT or EBADF, file doesn't exist - use 'wx' flag for exclusive creation
        if (error.code === 'ENOENT' || error.code === 'EBADF') {
          return 'wx';
        }
        // Other errors should propagate
        throw error;
      }
  }
  else {
    return 'w';
  }
}

export async function smartCopy(source:string, target:string, filesize:number, maxBufferSize :number) {
  let readStream: fs.ReadStream = null; 
  let writeStream: fs.WriteStream = null; 
  
  try {    
    const bufferSize = getOptimalBufferSize(filesize, maxBufferSize);

    // First verify source file exists and is readable
    try {
      await fs.promises.access(source, fs.constants.R_OK);
    } catch {
      throw new Error(`Source file ${source} does not exist or is not readable`);
    }

    // Get destination directory and ensure it exists with collision detection
    const destDir = path.dirname(target);
    
    // Create destination directory with collision detection
    await createDirectory(destDir);

    //Read Stream from Source
    readStream = fs.createReadStream(source, { highWaterMark: bufferSize });

    // Determine appropriate write flags (handles 8.3 collision prevention for Windows tilde files)
    let flag = await getWriteStreamFlags(target);
    
    writeStream = fs.createWriteStream(target, { flags: flag, highWaterMark: bufferSize });
    let hash = crypto.createHash('sha256');

    const copyStreamStart = Date.now();
    const sourceCheckSum  = await new Promise((resolve, reject) => {
      let errored = false;

      readStream.on('data', (chunk) => {
        hash.update(chunk);
      });

      readStream.on('error', (err) => {
        if (!errored) {
          errored = true;
          console.error(`Worker Thread - ${workerData?.threadNumber} - Error reading source file:`, err);
          reject(err);
        }
      });

      writeStream.on('error', (err: any) => {
        if (!errored) {
          errored = true;
          console.error(`Worker Thread - ${workerData?.threadNumber} - Error writing to target file:`, err);
          // EEXIST on tilde files indicates 8.3 collision 
          if (err.code === 'EEXIST' && process.platform === WINDOWS && target.includes('~')) {
            reject(new E8Dot3CollisionError(target));
          } else {
            reject(err);
          }
        }
      });

      writeStream.on('finish', () => {
        // Ensure all data has been written before resolving
        resolve(hash.digest('hex'));
      });

      readStream.pipe(writeStream);
    });
    const copyStreamMs = Date.now() - copyStreamStart;

    const checksumTargetStart = Date.now();
    const targetCheckSum = await calculateChecksum(target);
    const checksumTargetMs = Date.now() - checksumTargetStart;
    
    return {
      sourceChecksum: sourceCheckSum,
      targetChecksum: targetCheckSum,
      copyStreamMs,
      checksumTargetMs,
    };
  }catch(error){
    console.error(`Worker Thread - ${workerData?.threadNumber} - Error during smartCopy from ${source} to ${target}:`, error);
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


parentPort.on('message', async (tasks: WorkerThreadInput[]) => {
  const result:WorkerThreadOutput[] = await Promise.all(tasks.map(async(task)=> {
    try {
        const result = await smartCopy(task.data.sourcePath, task.data.destinationPath, task.data.size, task.data.maxBufferSize);
        return { isResolved: true, id: task.id, data: { ...result, jobRunId: task.data?.jobRunId }, Operation: task.Operation };
    } catch (error) {
        console.error(`Worker Thread - ${workerData?.threadNumber} - Error processing task ${task.id}:`, error);
        return {  isRejected: true, id: task.id, data: {code: error?.code, message:error?.message }, Operation: task.Operation };
    }
  }))
  parentPort.postMessage(result);
  
});

parentPort.onMessageerror = (err) => {
  console.error('There was an error in the parent port message', err);
}

process.on('uncaughtException', (err) => {
  console.error('There was an uncaught error', err);
  process.exit(1); //mandatory (as per the Node.js docs)
});