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
    let counter=0;
   
    for await (const directory of jobContext.groupReadDirs('consumer-1',directoryBatchSize)) {
      counter++;
      if (counter > directoryBatchSize){
        console.log("breaking the loop of pubish task"); 
        break;
      }
      const ops = {
        0: {
          cmd: 'SCAN',
          status: 'PENDING',
        },
      };

      const commands = new Command(directory.path, ops, `cmd-${uuid4()}`);
      commandsBatch.push(commands);
      if(commandsBatch && commandsBatch.length>=100){
        const task = new Task(
          uuid4(),
          traceId,
          'SCAN',
          'PENDING',
          jobContext.jobConfig.workerIds[0],
          jobContext.jobConfig.sourceFileServer.pathId,
          commandsBatch,
        );
        const id =  await jobContext.appendToTaskList(task);
        jobContext.tasksInfo.lastId = id;
        logger.debug(`[${traceId}] Task appended: ${JSON.stringify(task)}`);
        await redisClient.set(traceId, jobContext.serialize());
        logger.log(`[${traceId}] JobContext updated in Redis.`);
        commandsBatch=[];
       }
      }
    if(commandsBatch && commandsBatch.length>0){
      const task = new Task(
        uuid4(),
        traceId,
        'SCAN',
        'PENDING',
        jobContext.jobConfig.workerIds[0],
        jobContext.jobConfig.sourceFileServer.pathId,
        commandsBatch,
      );
      const id =  await jobContext.appendToTaskList(task);
      jobContext.tasksInfo.lastId = id;
      logger.debug(`[${traceId}] Task appended: ${JSON.stringify(task)}`);
      await redisClient.set(traceId, jobContext.serialize());
      logger.log(`[${traceId}] JobContext updated in Redis.`);
    }
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
