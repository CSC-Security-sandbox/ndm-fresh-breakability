import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { WorkerThreadInput, WorkerThreadOutput } from "./worker.thread.type";
const { parentPort, workerData } = require('worker_threads');

console.log(`Worker Thread - Starting Worker Thread  ${workerData?.threadNumber} for operationBand: ${workerData?.operationBand}`); 

export async function calculateChecksum(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      return reject(new Error(`File not found: ${filePath}`));
    }
    
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}

export async function copyFileWithChecksum(sourceFile: string, destinationFile: string): Promise<{sourceChecksum: string, targetChecksum:string}> {
    console.debug(`Worker Thread - Copying file from ${sourceFile} to ${destinationFile}`);
    if (!fs.existsSync(sourceFile)) {
      throw new Error(`Source file does not exist: ${sourceFile}`);
    }

    const destDir = path.dirname(destinationFile);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
  
    const hash = crypto.createHash("sha256");
  
    await new Promise<void>((resolve, reject) => {
      const readStream = fs.createReadStream(sourceFile, {
        highWaterMark: 1024*1024,
      });
      const writeStream = fs.createWriteStream(destinationFile);
  
      readStream.on("data", (chunk) => {
        hash.update(chunk);
        if (!writeStream.write(chunk)) readStream.pause();
      });
  
      writeStream.on("drain", () => readStream.resume());
  
      readStream.on("end", () => writeStream.end());
      writeStream.on("finish", resolve);
      readStream.on("error", reject);
      writeStream.on("error", reject);

    });
  
    const sourceChecksum = hash.digest("hex");
    const targetChecksum = await calculateChecksum(destinationFile);
  
    if (sourceChecksum !== targetChecksum) {
      throw new Error(`Checksum mismatch for file ${destinationFile}. Checksum: ${sourceChecksum} != ${targetChecksum}`);
    }
    return {sourceChecksum, targetChecksum};
}


parentPort.on('message', async (tasks: WorkerThreadInput[]) => {
  const result:WorkerThreadOutput[] = await Promise.all(tasks.map(async(task)=> {
    try {
        const result = await copyFileWithChecksum(task.data.sourcePath, task.data.destinationPath);
        return { isResolved: true, id: task.id, data: result, Operation: task.Operation };
    } catch (error) {
        return {  isRejected: true, id: task.id, data: error, Operation: task.Operation };
    }
  }))
  parentPort.postMessage(result);
  
});
