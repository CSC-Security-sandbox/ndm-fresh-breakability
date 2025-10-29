import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { WorkerThreadInput, WorkerThreadOutput } from "./worker.thread.type";
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

    // Special handling for potential 8.3 collisions on Windows
    if (process.platform === 'win32') {
      const fileName = path.basename(target);
      if (fileName.includes('~')) {
        // Smart 8.3 collision detection: distinguish between legitimate existing files and collisions
        try {
          // First, check if file already exists
          const fileExists = await fs.promises.access(target, fs.constants.F_OK).then(() => true).catch(() => false);
          
          if (fileExists) {
            // File exists - test if it's accessible (legitimate) or collision
            try {
              const testHandle = await fs.promises.open(target, 'r+');
              await testHandle.close();
              // Successfully opened for read/write = legitimate existing file
              console.log(`Worker Thread - ${workerData?.threadNumber} - File '${fileName}' exists from previous migration, will overwrite`);
            } catch (accessError: any) {
              // Cannot access for read/write - likely 8.3 collision or permission issue
              if (accessError.code === 'ENOENT' || accessError.code === 'EPERM' || accessError.code === 'EACCES') {
                const collisionError: any = new Error(`8.3 short filename collision detected: File '${fileName}' cannot be accessed for writing (${accessError.code}) - conflicts with auto-generated short name of another file`);
                collisionError.code = 'E8DOT3_COLLISION';
                throw collisionError;
              }
              // For other errors, re-throw the original error
              throw accessError;
            }
          } else {
            // File doesn't exist - try to create it to detect collision
            try {
              await fs.promises.writeFile(target, '', { flag: 'wx' });
              // Successfully created test file - remove it immediately to avoid corrupting actual copy
              await fs.promises.unlink(target);
              console.log(`Worker Thread - ${workerData?.threadNumber} - No collision detected for '${fileName}', ready for copy`);
            } catch (createError: any) {
              if (createError?.code === 'EEXIST' || createError?.code === 'EPERM' || createError?.code === 'EACCES') {
                // This is a true collision - file exists or permission denied due to collision
                const collisionError: any = new Error(`8.3 short filename collision detected: File '${fileName}' conflicts with auto-generated short name (${createError.code})`);
                collisionError.code = 'E8DOT3_COLLISION';
                throw collisionError;
              }
              throw createError;
            }
          }
        } catch (error: any) {
          // Re-throw 8.3 collision errors
          if (error.message.includes('8.3 short filename collision')) {
            throw error;
          }
          // For other errors, continue with normal flow
          console.log(`Worker Thread - ${workerData?.threadNumber} - Error during 8.3 collision check: ${error.message}, continuing...`);
        }
      }
    }

    // Create streams for content copying
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
          console.error(`Worker Thread - ${workerData?.threadNumber} - Error reading source file:`, err);
          reject(err);
        }
      });

      writeStream.on('error', (err) => {
        if (!errored) {
          errored = true;
          console.error(`Worker Thread - ${workerData?.threadNumber} - Error writing to target file:`, err);
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
    
    // // Final verification: ensure checksum matches (in case of any overwrites during copy)
    // if (sourceCheckSum !== targetCheckSum) {
    //   const fileName = path.basename(target);
    //   if (process.platform === 'win32' && fileName.includes('~')) {
    //     const collisionError: any = new Error(`8.3 short filename collision detected: File '${fileName}' checksum mismatch suggests collision with auto-generated short name`);
    //     collisionError.code = 'E8DOT3_COLLISION';
    //     throw collisionError;
    //   } else {
    //     throw new Error(`Checksum mismatch detected: source ${sourceCheckSum}, target ${targetCheckSum}`);
    //   }
    // }
    
    return {sourceChecksum: sourceCheckSum, targetChecksum: targetCheckSum};
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
        return { isResolved: true, id: task.id, data: result, Operation: task.Operation };
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