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

export async function smartCopy(source, target) {
  const destDir = path.dirname(target);  
  await fs.promises.mkdir(destDir, { recursive: true });
  let readStream: fs.ReadStream = null; 
  let writeStream: fs.WriteStream = null; 
  try{
    // TODO: make this chunk size configurable or based on the file size
    readStream = fs.createReadStream(source, { highWaterMark: 1024 * 1024 });
    writeStream = fs.createWriteStream(target);
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
    if (targetCheckSum !== sourceCheckSum) {
      throw new Error(`Checksum mismatch for file ${target}. Checksum: ${targetCheckSum} != ${sourceCheckSum}`);
    }
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
        const result = await smartCopy(task.data.sourcePath, task.data.destinationPath);
        return { isResolved: true, id: task.id, data: result, Operation: task.Operation };
    } catch (error) {
        return {  isRejected: true, id: task.id, data: {code: error?.code, message:error?.message }, Operation: task.Operation };
    }
  }))
  parentPort.postMessage(result);
  
});
