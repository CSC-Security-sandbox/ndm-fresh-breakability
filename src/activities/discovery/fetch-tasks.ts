import { Logger } from '@nestjs/common'; 
import { JobContextFactory, RedisUtils } from '@netapp-cloud-datamigrate/jobs-lib';

export async function fetchTasks(traceId: string): Promise<any[]> {
  const logger = new Logger('FetchTasks'); 
  logger.log(`[${traceId}] Starting task fetching process...`);

  let redisClient = null;
  const streamMessages = []; 
  try {
    redisClient = await RedisUtils.getClient();
    if (!redisClient.isOpen) {
      await redisClient.connect();
      logger.log(`[${traceId}] Connected to Redis client.`);
    }
    const batchSize = 500;
    const contextProvider = JobContextFactory.getProvider('redis', redisClient);
    const jobContext = await contextProvider.getJobContext(traceId);
    console.log("lastId" + jobContext.tasksInfo.lastId);
    if (!jobContext) {
      logger.warn(`[${traceId}] No JobContext found. Returning empty list.`);
      return [];
    }

    logger.log(`[${traceId}] JobContext found. Starting task reading... ${streamMessages.length} && and batch size is ${batchSize}`); 
   
    for await (const task of jobContext.groupReadTasks('consumer-1',batchSize)) {
      if(streamMessages.length <batchSize) {
        console.log('Pushed into streamMessages');
      streamMessages.push(task);
      } else {
        break;
      }
    }
    logger.log(`[${traceId}] Successfully fetched ${streamMessages.length} tasks.`);
    return streamMessages;
    
  } catch (error) {
    logger.error(`[${traceId}] Failed to fetch the task: ${error}`);
    return []; 
  } 
  finally {
    if (redisClient && redisClient.isOpen) {
      await redisClient.quit();
      logger.log(`[${traceId}] Redis client connection closed.`);
    }
  }
}