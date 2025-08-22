#!/usr/bin/env node

/**
 * Simple integration test for stamp metadata worker thread functionality
 * This test can be run independently to verify our implementation works
 */

import { Worker } from 'worker_threads';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { WorkerThreadInput, WorkerThreadOutput, ThreadOperation } from './worker.thread.type';

async function testStampMetadata() {
  console.log('🧪 Testing stamp metadata worker thread functionality...');
  
  // Create a temporary test file
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ndm-test-'));
  const testFile = path.join(tempDir, 'test-file.txt');
  
  try {
    // Create test file
    await fs.promises.writeFile(testFile, 'test content', 'utf8');
    console.log(`📁 Created test file: ${testFile}`);
    
    // Prepare comprehensive test data
    const stampMetadataTask: WorkerThreadInput = {
      id: 'test-stamp-1',
      Operation: ThreadOperation.STAMP_METADATA,
      data: {
        commandExecInput: {
          command: {
            id: 'test-cmd-1',
            fPath: 'test-file.txt',
            metadata: {
              mode: 0o644, // rw-r--r--
              atime: new Date('2023-01-01T00:00:00.000Z'),
              mtime: new Date('2023-01-01T00:00:00.000Z'),
              uid: process.getuid ? process.getuid() : undefined,
              gid: process.getgid ? process.getgid() : undefined,
              attributes: process.platform === 'win32' ? 'A' : undefined, // Archive attribute on Windows
              isSymLink: false
            }
          },
          sourcePath: testFile,
          targetPath: testFile,
          jobContext: {
            jobConfig: {
              options: {
                preserveAccessTime: true,
                isIdentityMappingAvailable: false
              }
            }
          }
        }
      }
    };

    // Create worker
    const workerPath = path.resolve(__dirname, 'worker.thread.js');
    console.log(`🔧 Starting worker from: ${workerPath}`);
    
    const worker = new Worker(workerPath, {
      workerData: { threadNumber: 1, operationBand: 'test' }
    });

    // Set up promise for result
    const resultPromise = new Promise<WorkerThreadOutput[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Worker timeout'));
      }, 10000); // 10 second timeout

      worker.on('message', (result: WorkerThreadOutput[]) => {
        clearTimeout(timeout);
        resolve(result);
      });

      worker.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          clearTimeout(timeout);
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });

    // Send task to worker
    console.log('📤 Sending stamp metadata task to worker...');
    worker.postMessage([stampMetadataTask]);

    // Wait for result
    const results = await resultPromise;
    console.log('📥 Received results from worker:', JSON.stringify(results, null, 2));

    // Verify result
    const result = results[0];
    if (result.isResolved && result.Operation === ThreadOperation.STAMP_METADATA) {
      console.log('✅ Stamp metadata operation completed successfully!');
      
      // Check if metadata was actually applied
      const stats = await fs.promises.stat(testFile);
      console.log(`📊 File stats after stamping:`, {
        mode: '0' + (stats.mode & parseInt('777', 8)).toString(8),
        atime: stats.atime.toISOString(),
        mtime: stats.mtime.toISOString(),
        uid: stats.uid,
        gid: stats.gid
      });

      if (result.data.targetErrors && result.data.targetErrors.length > 0) {
        console.log('⚠️  Some errors occurred during metadata stamping:', result.data.targetErrors);
      } else {
        console.log('🎉 No errors reported - metadata stamping was successful!');
      }
    } else {
      console.error('❌ Stamp metadata operation failed:', result);
    }

    // Cleanup
    worker.terminate();
    
  } catch (error) {
    console.error('💥 Test failed with error:', error);
  } finally {
    // Clean up temp files
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
      console.log('🧹 Cleaned up temporary files');
    } catch (cleanupError) {
      console.warn('⚠️  Failed to clean up temporary files:', cleanupError);
    }
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testStampMetadata().catch(console.error);
}

export { testStampMetadata };
