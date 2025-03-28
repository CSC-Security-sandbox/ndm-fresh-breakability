// import { ActivitiesModule } from "src/activities/activities.module";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { ThreadOperation, ThreadTaskInput } from "./worker.thread.type";
const { parentPort } = require('worker_threads');

// const { NestFactory } = require('@nestjs/core');
console.log('Worker Thread - Starting Worker Thread');

async function calculateChecksum(filePath: string): Promise<string> {
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

async function copyFileWithChecksum(sourceFile: string, destinationFile: string): Promise<{sourceChecksum: string, targetChecksum:string}> {
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


parentPort.on('message', async (task: ThreadTaskInput) => {
  console.debug(`Worker Thread - Received task: ${JSON.stringify(task)}`);
  switch (task.Operation) {
      case ThreadOperation.COPY_FILE:
          try{
              const result = await copyFileWithChecksum(task.data.sourcePath, task.data.destinationPath);
              parentPort.postMessage({ isResolved: true, id: task.id, data: result, Operation: task.Operation });
          }
          catch (error) {
              parentPort.postMessage({ isRejected: true, id: task.id, data: error, Operation: task.Operation });
          }
      default: 
          parentPort.postMessage(task);
          break;
  }
});

// process.on('SIGTERM', async () => {
//   console.log('Worker received SIGTERM');
//   await app.close();
//   process.exit(0);
// });

// process.on('SIGINT', async () => {
//   console.log('Worker received SIGINT');
//   await app.close();
//   process.exit(0);
// });

// process.on('beforeExit', async () => {
//   console.log('Worker is shutting down...');
//   await app.close();
// });

// bootstrap();
