import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { WorkerThreadInput, WorkerThreadOutput, ThreadOperation } from "./worker.thread.type";
const { parentPort, workerData } = require('worker_threads');

const execAsync = promisify(exec);

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
  if (fileSize < 52428800) return 2097152; //  50MB - buffer 2MB
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

export async function stampMetadata(task: any) {
  const { commandExecInput } = task;
  const { command, sourcePath, targetPath, jobContext } = commandExecInput;
  const output = { sourceErrors: [], targetErrors: [], shouldStampMeta: false, shouldUpdateItemInfo: true };

  console.log(`[${command.id}] Starting metadata stamping from ${sourcePath} to ${targetPath}`);

  try {
    // Platform-specific operations
    if (process.platform === 'win32') {
      // Windows metadata stamping operations
      
      // 1. Stamp file attributes
      await stampWindowsFileAttributes(commandExecInput, output);
      
      // 2. Preserve access and modified time on source (if enabled)
      await preserveAccessAndModifiedTimeWindows(commandExecInput, output);
      
      // 3. Stamp access and modified time on target
      await stampAccessAndModifiedTimeWindows(commandExecInput, output);
      
      // 4. Stamp permissions
      await stampPermissionsWindows(commandExecInput, output);
      
      // Note: SID/ACL operations are complex and require specialized libraries
      // For now, we'll log that ACL stamping was requested but skip implementation
      if (command.metadata?.acl || command.metadata?.sid) {
        console.log(`[${command.id}] ACL/SID stamping requested but requires specialized handling - skipping in worker thread`);
        output.targetErrors.push({
          code: 'ACL_SKIPPED',
          message: 'ACL/SID operations require main thread processing',
          path: targetPath
        });
      }
    } else {
      // Unix/Linux metadata stamping operations
      
      // 1. Stamp GID and UID
      await stampGIDandUIDUnix(commandExecInput, output);
      
      // 2. Preserve access and modified time on source (if enabled)
      await preserveAccessAndModifiedTimeUnix(commandExecInput, output);
      
      // 3. Stamp access and modified time on target
      await stampAccessAndModifiedTimeUnix(commandExecInput, output);
      
      // 4. Stamp permissions
      await stampPermissionsUnix(commandExecInput, output);
    }

    console.log(`[${command.id}] Metadata stamping completed. Errors: ${output.sourceErrors.length} source, ${output.targetErrors.length} target`);
    return output;
  } catch (error) {
    console.error(`[${command.id}] Fatal error during metadata stamping:`, error);
    output.targetErrors.push({
      code: error.code || 'METADATA_ERROR',
      message: `Failed to stamp metadata: ${error.message}`,
      path: targetPath
    });
    return output;
  }
}

// Windows-specific metadata operations
async function stampWindowsFileAttributes(commandExecInput: any, output: any) {
  const { command, sourcePath, targetPath } = commandExecInput;
  if (!command.metadata?.attributes && !sourcePath) return;

  const attributeRegex = /^([A-Za-z]:[\\/]|[\\/])/;
  let sourceAttributes = '';
  let targetAttributes = '';

  try {
    // Get source file attributes
    if (sourcePath) {
      try {
        const { stdout: fileAttr } = await execAsync(`attrib "${sourcePath}"`);
        sourceAttributes = fileAttr?.trim().split(/\s+/).filter(token => !attributeRegex.test(token)).join('');
        console.log(`Source file attributes for ${sourcePath}: ${sourceAttributes}`);
      } catch (error) {
        console.error(`Getting source attributes for ${sourcePath}, Error: ${error.message}`);
        output.sourceErrors.push({
          code: error.code || 'ATTRIB_READ_ERROR',
          message: `Failed to read source attributes: ${error.message}`,
          path: sourcePath
        });
        return;
      }
    } else if (command.metadata?.attributes) {
      sourceAttributes = command.metadata.attributes;
    }

    // Get target file attributes
    try {
      const { stdout: targetAttr } = await execAsync(`attrib "${targetPath}"`);
      targetAttributes = targetAttr?.trim().split(/\s+/).filter(token => !attributeRegex.test(token)).join('');
      console.log(`Target file attributes for ${targetPath}: ${targetAttributes}`);
    } catch (error) {
      console.warn(`Could not get target attributes for ${targetPath}, assuming no attributes: ${error.message}`);
      targetAttributes = '';
    }

    // Calculate attribute changes needed
    const attributesToAdd = [];
    const attributesToRemove = [];
    const allAttributes = ['H', 'S', 'R', 'A'];

    for (const attr of allAttributes) {
      const sourceHasAttr = sourceAttributes.includes(attr);
      const targetHasAttr = targetAttributes.includes(attr);

      if (sourceHasAttr && !targetHasAttr) {
        attributesToAdd.push(`+${attr}`);
      } else if (!sourceHasAttr && targetHasAttr) {
        attributesToRemove.push(`-${attr}`);
      }
    }

    const allAttributeChanges = [...attributesToAdd, ...attributesToRemove];
    console.log(`Attribute changes needed for ${targetPath}: ${allAttributeChanges.join(' ')}`);

    if (allAttributeChanges.length > 0) {
      const attributeCommand = `attrib ${allAttributeChanges.join(' ')} "${targetPath}"`;
      console.log(`Executing attribute command: ${attributeCommand}`);
      await execAsync(attributeCommand);

      // Verify changes
      try {
        const { stdout: verifyAttr } = await execAsync(`attrib "${targetPath}"`);
        const finalAttributes = verifyAttr?.trim().split(/\s+/).filter(token => !attributeRegex.test(token)).join('');

        if (finalAttributes === sourceAttributes) {
          console.log(`Attributes successfully synchronized for ${targetPath}: ${finalAttributes}`);
        } else {
          console.warn(`Attribute mismatch after sync - Expected: ${sourceAttributes}, Actual: ${finalAttributes}`);
        }
      } catch (verifyError) {
        console.warn(`Could not verify attribute changes: ${verifyError.message}`);
      }
    } else {
      console.log(`No attribute changes needed for ${targetPath} - already synchronized`);
    }

  } catch (error) {
    console.error(`Setting/removing attributes for ${targetPath} failed, Error: ${error.message}`);
    output.targetErrors.push({
      code: error.code || 'ATTRIB_ERROR',
      message: `Failed to set attributes on ${targetPath}: ${error.message}`,
      path: targetPath
    });
  }
}

async function preserveAccessAndModifiedTimeWindows(commandExecInput: any, output: any) {
  const { command, sourcePath, jobContext } = commandExecInput;
  
  if (!command.metadata?.mtime || !command.metadata?.atime || !jobContext?.jobConfig?.options?.preserveAccessTime) {
    return;
  }

  try {
    if (command?.metadata?.isSymLink) {
      await fs.promises.lutimes(sourcePath, new Date(command.metadata.atime), new Date(command.metadata.mtime));
    } else {
      await fs.promises.utimes(sourcePath, new Date(command.metadata.atime), new Date(command.metadata.mtime));
    }
    console.log(`Preserved access and modified time for source: ${sourcePath}`);
  } catch (error) {
    console.error(`Preserve Access and Modified Time to ${sourcePath}, Error: ${error.message}`);
    output.sourceErrors.push({
      code: error.code || 'TIME_PRESERVE_ERROR',
      message: `Failed to preserve timestamps on ${sourcePath}: ${error.message}`,
      path: sourcePath
    });
  }
}

async function stampAccessAndModifiedTimeWindows(commandExecInput: any, output: any) {
  const { command, targetPath } = commandExecInput;

  if (!command.metadata?.mtime || !command.metadata?.atime) {
    return;
  }

  try {
    await fs.promises.utimes(targetPath, new Date(command.metadata.atime), new Date(command.metadata.mtime));
    console.log(`Stamped access and modified time for target: ${targetPath}`);
  } catch (error) {
    console.error(`Stamping Access and Modified Time to ${targetPath}, Error: ${error.message}`);
    output.targetErrors.push({
      code: error.code || 'TIME_STAMP_ERROR',
      message: `Failed to set timestamps on ${targetPath}: ${error.message}`,
      path: targetPath
    });
  }
}

async function stampPermissionsWindows(commandExecInput: any, output: any) {
  const { command, targetPath } = commandExecInput;

  if (!command.metadata?.mode) {
    return;
  }

  try {
    await fs.promises.chmod(targetPath, command.metadata.mode);
    console.log(`Stamped permissions for Windows target: ${targetPath}`);
  } catch (error) {
    console.error(`Stamping Permission to ${targetPath}, Error: ${error.message}`);
    output.targetErrors.push({
      code: error.code || 'PERMISSION_ERROR',
      message: `Failed to set permissions on ${targetPath}: ${error.message}`,
      path: targetPath
    });
  }
}

// Unix/Linux-specific metadata operations
async function stampGIDandUIDUnix(commandExecInput: any, output: any) {
  const { command, targetPath, jobContext } = commandExecInput;

  if (!command.metadata?.gid || !command.metadata?.uid) {
    return;
  }

  try {
    let gid = command.metadata.gid?.toString();
    let uid = command.metadata.uid?.toString();

    // Handle identity mapping if available (simplified version)
    if (jobContext?.jobConfig?.options?.isIdentityMappingAvailable) {
      console.log(`Identity mapping requested for UID: ${uid}, GID: ${gid}`);
      // Note: Redis-based identity mapping would require the Redis service
      // For worker thread, we'll use the original values
    }

    if (gid && uid) {
      await fs.promises.chown(targetPath, parseInt(uid), parseInt(gid));
      console.log(`Stamped ownership for Unix target: ${targetPath} (uid: ${uid}, gid: ${gid})`);
    }
  } catch (error) {
    console.error(`Stamping GID and UID to ${targetPath}, Error: ${error.message}`);
    output.targetErrors.push({
      code: error.code || 'CHOWN_ERROR',
      message: `Failed to set ownership on ${targetPath}: ${error.message}`,
      path: targetPath
    });
  }
}

async function preserveAccessAndModifiedTimeUnix(commandExecInput: any, output: any) {
  const { command, sourcePath, jobContext } = commandExecInput;
  
  if (!command.metadata?.mtime || !command.metadata?.atime || !jobContext?.jobConfig?.options?.preserveAccessTime) {
    return;
  }

  try {
    if (command?.metadata?.isSymLink) {
      await fs.promises.lutimes(sourcePath, new Date(command.metadata.atime), new Date(command.metadata.mtime));
    } else {
      await fs.promises.utimes(sourcePath, new Date(command.metadata.atime), new Date(command.metadata.mtime));
    }
    console.log(`Preserved access and modified time for Unix source: ${sourcePath}`);
  } catch (error) {
    console.error(`Preserve Access and Modified Time to ${sourcePath}, Error: ${error.message}`);
    output.sourceErrors.push({
      code: error.code || 'TIME_PRESERVE_ERROR',
      message: `Failed to preserve timestamps on ${sourcePath}: ${error.message}`,
      path: sourcePath
    });
  }
}

async function stampAccessAndModifiedTimeUnix(commandExecInput: any, output: any) {
  const { command, targetPath } = commandExecInput;

  if (!command.metadata?.mtime || !command.metadata?.atime) {
    return;
  }

  try {
    await fs.promises.utimes(targetPath, new Date(command.metadata.atime), new Date(command.metadata.mtime));
    console.log(`Stamped access and modified time for Unix target: ${targetPath}`);
  } catch (error) {
    console.error(`Stamping Access and Modified Time to ${targetPath}, Error: ${error.message}`);
    output.targetErrors.push({
      code: error.code || 'TIME_STAMP_ERROR',
      message: `Failed to set timestamps on ${targetPath}: ${error.message}`,
      path: targetPath
    });
  }
}

async function stampPermissionsUnix(commandExecInput: any, output: any) {
  const { command, targetPath } = commandExecInput;

  if (!command.metadata?.mode) {
    return;
  }

  try {
    await fs.promises.chmod(targetPath, command.metadata.mode);
    console.log(`Stamped permissions for Unix target: ${targetPath}`);
  } catch (error) {
    console.error(`Stamping Permission to ${targetPath}, Error: ${error.message}`);
    output.targetErrors.push({
      code: error.code || 'PERMISSION_ERROR',
      message: `Failed to set permissions on ${targetPath}: ${error.message}`,
      path: targetPath
    });
  }
}


parentPort.on('message', async (tasks: WorkerThreadInput[]) => {
  const result: WorkerThreadOutput[] = await Promise.all(tasks.map(async (task) => {
    try {
      let result;
      
      switch (task.Operation) {
        case ThreadOperation.COPY_FILE:
          result = await smartCopy(task.data.sourcePath, task.data.destinationPath, task.data.size, task.data.maxBufferSize);
          break;
          
        case ThreadOperation.STAMP_METADATA:
          result = await stampMetadata(task.data);
          break;
          
        default:
          throw new Error(`Unsupported operation: ${task.Operation}`);
      }
      
      return { isResolved: true, id: task.id, data: result, Operation: task.Operation };
    } catch (error) {
      return { isRejected: true, id: task.id, data: { code: error?.code, message: error?.message }, Operation: task.Operation };
    }
  }));
  
  parentPort.postMessage(result);
});
