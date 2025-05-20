import { continueAsNew, proxyActivities, sleep, log, ContinueAsNew } from '@temporalio/workflow';
import { RedisMemoryCheckActivity } from 'src/activities/redis/redis.mem.usage.check.activity';

const { checkMemoryUsage } = proxyActivities<RedisMemoryCheckActivity>({
  startToCloseTimeout: '1m',
    retry: {
        maximumAttempts: 3,
        initialInterval: '1s',
        backoffCoefficient: 2,
        maximumInterval: '10s',
    },
});

export const RedisMemoryCheckWorkflow = async (traceId): Promise<boolean> => {
  // Call the activity that checks redis memory usage.
  let iterations= 0;
  let maxIterations = 30;
  let sleepTime = 10000; // 10 seconds
  while(true) {
    iterations++;
    try{
      const isMemoryOk: boolean = await checkMemoryUsage();
      if (isMemoryOk){
        return true;
      }else {
        log.info(`Redis memory usage beyond threshold. Sleeping..`);
        await sleep(sleepTime);
      }
    }catch (error) {
      if(error instanceof ContinueAsNew) {
        throw error;
      }
      log.error(`Error in RedisMemoryCheckWorkflow: ${error}`);
    }

    if(iterations > maxIterations){
      log.error(`Max iterations reached. Redis memory check failed.`);
      await continueAsNew(traceId);
    }
  }
  
};