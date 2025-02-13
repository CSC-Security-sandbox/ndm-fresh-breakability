import { Command, JobContextFactory, RedisUtils, Task } from '@netapp-cloud-datamigrate/jobs-lib';
import { uuid4 } from '@temporalio/workflow';
import { Logger } from '@nestjs/common';

export async function publishTask(traceId: string): Promise<any> {
  const logger = new Logger('PublishTask'); 
  logger.log(`[${traceId}] Starting publishTask`);

  let redisClient = null;
  let commandsBatch=[];


  try {
    redisClient = await RedisUtils.getClient();
    if (!redisClient.isOpen) {
      await redisClient.connect();
      logger.log(`[${traceId}] Connected to Redis client.`);
    }

    
    const contextProvider = JobContextFactory.getProvider('redis', redisClient);
    const jobContext = await contextProvider.getJobContext(traceId);

    if (!jobContext) {
      logger.warn(`[${traceId}] No JobContext found. Exiting.`);
      return { status: 'failure', message: 'No JobContext found' };
    }

    logger.log(`[${traceId}] JobContext retrieved. Processing files.`);

    // Process files and append tasks
    const directoryBatchSize = 500;
    let counter = 0;
    let commandsBatch: Command[] = [];
    
    const directories = jobContext.groupReadDirs('consumer-1', directoryBatchSize);
    
    for await (const directory of directories) {
      counter++;
      // Create a command and add it to the batch
      const command = new Command(directory.path, { 
        0: { cmd: 'SCAN', status: 'PENDING' } 
      }, `cmd-${uuid4()}`);
      
      commandsBatch.push(command);
    
      // If we reach directoryBatchSize, create a new task
      if (commandsBatch.length >= directoryBatchSize) {
        const task = new Task(
          uuid4(),
          traceId,
          'SCAN',
          'PENDING',
          'worker-1',
          '/mnt/nfs/test.txt',
          commandsBatch, // Task now holds 500 commands
        );
    
        jobContext.tasksInfo.lastId = await jobContext.appendToTaskList(task);
        logger.debug(`[${traceId}] Task appended: ${JSON.stringify(task)}`);
        commandsBatch = [];
      }
    
      if (counter >= directoryBatchSize) {
        console.log('Breaking the loop of publish task');
        break;
      }
    }
    
    // If there are remaining commands that didn't reach 500, process them
    if (commandsBatch.length > 0) {
      const task = new Task(
        uuid4(),
        traceId,
        'SCAN',
        'PENDING',
        'worker-1',
        '/mnt/nfs/test.txt',
        commandsBatch,
      );
      jobContext.tasksInfo.lastId = await jobContext.appendToTaskList(task);
      logger.debug(`[${traceId}] Task appended: ${JSON.stringify(task)}`);
    }
    
    // Save the updated job context in Redis
    await redisClient.set(traceId, jobContext.serialize());
    logger.log(`[${traceId}] JobContext updated in Redis.`);    

    return { status: 'success', message: 'Task published successfully' };
  } catch (error) {
    logger.error(`[${traceId}] Error in publishing task: ${error.message}`, error.stack); 
    return {
      traceId: traceId,
      status: 'error',
      message: `Failed to publish task for Job run id ${traceId} : ${error}`,
    };
  } finally {
    if (redisClient && redisClient.isOpen) {
      await redisClient.quit();
      logger.log(`[${traceId}] Redis client connection closed.`);
    }
  }
}
