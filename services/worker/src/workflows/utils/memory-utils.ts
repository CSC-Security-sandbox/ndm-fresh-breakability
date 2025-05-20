import * as wf from '@temporalio/workflow';

export const waitUntilRedisMemoryOk = async (traceId): Promise<void> => {
  // Start the RedisMemoryCheckWorkflow as a child workflow
  const redisChild = await wf.startChild('RedisMemoryCheckWorkflow', {
    args: [],
    workflowId: `RedisMemoryCheckWorkflow-${traceId}`,
  });
  await redisChild.result();
  
}