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

async function checkFor8dot3Collision(target: string, workerNumber?: string): Promise<void> {
  const fileName = path.basename(target);
  try {
    await fs.promises.writeFile(target, '', { flag: 'wx' });
  } catch (createError: any) {
    if (createError?.code === 'EEXIST' || createError?.code === 'EPERM' || createError?.code === 'EACCES') {
      try {
        const realPath = await fs.promises.realpath(target);
        return; 
      } catch (realpathError) {
        console.error(`Worker Thread - ${workerNumber} - 8.3 collision detected: '${fileName}' conflicts with auto-generated short name`);
        const collisionError: any = new Error(`8.3 short filename collision detected: File '${fileName}' cannot be created due to short name collision.`);
        collisionError.code = 'E8DOT3_COLLISION';
        throw collisionError;
      }
    } else {
      throw createError;
    }
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
    
    try {
      // Create destination directory with collision detection
      await fs.promises.mkdir(destDir, { recursive: true });
      console.log(`Checking for ${destDir}`)
      if (process.platform === 'win32' && path.basename(destDir).includes('~')) {
        console.log(`Checking for ${destDir} and ${path.basename(destDir)} includes ~ and is created successfully.`)
        await fs.promises.realpath(destDir);}

    } catch (mkdirError: any) {
      console.log(`Worker Thread - ${workerData?.threadNumber} - Error creating directory ${destDir}:`, mkdirError);
      
      // Record directory failure for coordination with metadata operations
      // We'll create a simple mechanism to communicate this failure
      console.error(`8.3 collision detected: '${destDir}' conflicts with auto-generated short name`);
        const collisionError: any = new Error(`8.3 short filename collision detected: Directory '${destDir}' cannot be created due to short name collision.`);
        collisionError.code = 'E8DOT3_COLLISION';
        throw collisionError;
    }

    readStream = fs.createReadStream(source, { highWaterMark: bufferSize });

    // Check for file-level 8.3 collisions
    if (process.platform === 'win32' && path.basename(target).includes('~')) {
      await checkFor8dot3Collision(target, workerData?.threadNumber);
    }

    // Create write stream after all collision checks
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
    
    // Final verification: ensure checksum matches (in case of any overwrites during copy)
    if (sourceCheckSum !== targetCheckSum) {
      const fileName = path.basename(target);
      if (process.platform === 'win32' && fileName.includes('~')) {
        const collisionError: any = new Error(`8.3 short filename collision detected: File '${fileName}' checksum mismatch suggests collision with auto-generated short name. Source: ${sourceCheckSum}, Target: ${targetCheckSum}`);
        collisionError.code = 'E8DOT3_COLLISION';
        throw collisionError;
      } else {
        throw new Error(`Checksum mismatch detected: source ${sourceCheckSum}, target ${targetCheckSum}`);
      }
    }
    
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