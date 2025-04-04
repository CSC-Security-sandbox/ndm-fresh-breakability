import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { WorkerThreadInput, WorkerThreadOutput } from "./worker.thread.type";
const { parentPort, workerData } = require('worker_threads');

console.log(`Worker Thread - Starting Worker Thread  ${workerData?.threadNumber} for operationBand: ${workerData?.operationBand}`); 

export async function calculateChecksum(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  
  return hash.digest('hex');
}

export async function smartCopy(source, target) {

  if (!fs.existsSync(source)) {
    throw new Error(`Source file does not exist: ${source}`);
  }

  const destDir = path.dirname(target);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

    const readStream = fs.createReadStream(source, { highWaterMark: 1024 * 1024 });
    const writeStream = fs.createWriteStream(target);
    let hash;

    hash = crypto.createHash('sha256');
    readStream.on('data', (chunk) => hash.update(chunk));

    const targetChecksum  = await new Promise((resolve, reject) => {
      readStream.pipe(writeStream)
        .on('error', reject)
        .on('finish', () => {
          resolve( hash?.digest('hex'));
        });
    });
    const sourceChecksum = await calculateChecksum(source);
    if (sourceChecksum !== targetChecksum) {
      throw new Error(`Checksum mismatch for file ${target}. Checksum: ${sourceChecksum} != ${targetChecksum}`);
    }
    return {sourceChecksum, targetChecksum};
  }


parentPort.on('message', async (tasks: WorkerThreadInput[]) => {
  const result:WorkerThreadOutput[] = await Promise.all(tasks.map(async(task)=> {
    try {
        const startTime = Date.now();
        const result = await smartCopy(task.data.sourcePath, task.data.destinationPath);
        const  endTime = Date.now();
        // log the time taken for the operation
        console.log(`Time taken for ${task.data.sourcePath} operation: ${endTime - startTime} ms`);
        return { isResolved: true, id: task.id, data: result, Operation: task.Operation };
    } catch (error) {
        return {  isRejected: true, id: task.id, data: error, Operation: task.Operation };
    }
  }))
  parentPort.postMessage(result);
  
});
