import { Logger } from '@nestjs/common'; 
import { JobContextFactory, RedisUtils } from '@netapp-cloud-datamigrate/jobs-lib';

export async function fetchTasks(traceId: string): Promise<any> {
  const logger = new Logger('FetchTasks'); 
  logger.log(`[${traceId}] Starting task fetching process...`);

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
      logger.warn(`[${traceId}] No JobContext found. Exiting fetch process.`);
      return null;
    }

    logger.log(`[${traceId}] JobContext found. Starting task reading...`);
    const streamMessages = [];

    for await (const file of jobContext.groupReadTasks('consumer-1')) {
      logger.debug(`[${traceId}] Received file: ${JSON.stringify(file)}`);
      streamMessages.push(file);
    }

    logger.log(`[${traceId}] Successfully fetched ${streamMessages.length} tasks.`);
    return streamMessages;

  } catch (error) {
    logger.error(`[${traceId}] Failed to fetch the task: ${error}`);
    return {
      traceId: traceId,
      status: 'error',
      message: `Failed to fetch the task for Job run id ${traceId} : ${error}`,
    };

  } finally {
    if (redisClient && redisClient.isOpen) {
      await redisClient.quit();
      logger.log(`[${traceId}] Redis client connection closed.`);
    }
  }
}
