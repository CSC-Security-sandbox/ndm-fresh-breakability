import { Inject, Injectable, Logger } from '@nestjs/common';
import { WorkersConfig } from 'src/config/app.config';
import axios from 'axios';
import {
  JobContextFactory,
  RedisUtils,
} from '@netapp-cloud-datamigrate/jobs-lib';
import { ConfigService } from '@nestjs/config';
import { RedisService } from 'src/redis/redis.service';

@Injectable()
export class MigratorService {
  
  readonly workerId: string;
  readonly workerConfigUrl: string;
  constructor(
      @Inject(ConfigService) private readonly configService: ConfigService,
      private readonly logger: Logger,
      private readonly redisService: RedisService,
  ) {
      this.workerId = this.configService.get('worker.workerId');
      this.workerConfigUrl = this.configService.get('worker.workerConfigUrl');
  }

  async setupMigrator(jobRunId: string) {
    const workerId = WorkersConfig.get('workerId');
    let redisClient = null;

    try {
      
      const jobContext = await this.redisService.getJobContext(jobRunId);
      this.logger.log(`Job Context: ${JSON.stringify(jobContext.jobConfig)}`);
      
      await axios.post(`${this.workerConfigUrl}update/configs`, {
        jobRunId,
        workerIds: [workerId],
      });

    } catch (error) {
      this.logger.error(
        `[${jobRunId}] - Failed to set up worker ${workerId}: ${error.message}`,
      );
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
        this.logger.log(`[${jobRunId}] - Redis client connection closed.`);
      }
    }
  }
}
