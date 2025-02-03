import { Command, JobContextFactory, RedisUtils, Task } from '@netapp-cloud-datamigrate/jobs-lib';
import { uuid4 } from '@temporalio/workflow';
import { Logger } from '@nestjs/common';

export async function publishTask(traceId: string): Promise<any> {
  const logger = new Logger('PublishTask'); 
  logger.log(`[${traceId}] Starting publishTask`);

  let redisClient = null;

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
    for await (const file of jobContext.groupReadDirs('consumer-1')) {
      logger.debug(`[${traceId}] Processing file: ${JSON.stringify(file)}`);

      const ops = {
        0: {
          cmd: 'SCAN',
          status: 'PENDING',
        },
      };

      const commands = [new Command(file.path, ops, `cmd-${uuid4()}`)];

      const task = new Task(
        uuid4(),
        traceId,
        'SCAN',
        'PENDING',
        'worker-1',
        '/mnt/nfs/test.txt',
        null,
        '*.tmp, *.log',
        commands,
      );

      await jobContext.appendToTaskList(task);
      logger.debug(`[${traceId}] Task appended: ${JSON.stringify(task)}`);
    }

   
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
    // Clean up Redis client
    if (redisClient && redisClient.isOpen) {
      await redisClient.quit();
      logger.log(`[${traceId}] Redis client connection closed.`);
    }
  }
}
