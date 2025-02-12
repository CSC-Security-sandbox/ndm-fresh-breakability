import { Logger } from "@nestjs/common";
import { WorkersConfig } from "src/config/app.config";
import axios from 'axios';
import {
    JobContextFactory,
    RedisUtils,
  } from '@netapp-cloud-datamigrate/jobs-lib';

export async function setupMigrator(jobRunId:string) {
    const logger = new Logger('SETUP-MIGRATOR');
    const workerId = WorkersConfig.get('workerId');

    let redisClient = null;
    const contextProvider = JobContextFactory.getProvider('redis', redisClient);
    const context = await contextProvider.getJobContext(jobRunId);
    logger.log('Job Context' + JSON.stringify(context.jobConfig));

    try{
        const workerConfigUrl = WorkersConfig.get('workerConfigUrl');
        await axios.post(`${workerConfigUrl}update/configs`, {
            jobRunId: jobRunId,
            workerIds: [workerId],
          });
    }catch(error) {
        logger.error( `[${jobRunId}] - Failed to set up worker ${workerId}: ${error.message}`,);
            return {
                jobRunId,
                status: 'error',
                protocolType: null,
                hostname: null,
                workerId,
                message: `[${jobRunId}] - Worker setup failed: ${error.message}`,
            };
        } finally {
            if (redisClient && redisClient.isOpen) {
                await redisClient.quit();
                logger.log(`[${jobRunId}] - Redis client connection closed.`);
            }
    }

}