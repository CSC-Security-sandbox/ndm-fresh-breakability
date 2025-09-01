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
    console.log(` filesize : ${filesize}, selected buffer size: ${bufferSize}`);
    readStream = fs.createReadStream(source, { highWaterMark: bufferSize });
    writeStream = fs.createWriteStream(target, { flags: 'w', highWaterMark: bufferSize });
    let hash = crypto.createHash('sha256');
    readStream.on('data', (chunk) => hash.update(chunk));

    const sourceCheckSum  = await new Promise((resolve, reject) => {
      readStream.pipe(writeStream)
        .on('error', reject)
        .on('finish', () => {
          resolve( hash?.digest('hex'));
        });
    });
    const targetCheckSum = await calculateChecksum(target);
    return {sourceChecksum: sourceCheckSum, targetChecksum: targetCheckSum};
  }catch(error){
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
        return {  isRejected: true, id: task.id, data: {code: error?.code, message:error?.message }, Operation: task.Operation };
    }
  }))
  parentPort.postMessage(result);
  
});
