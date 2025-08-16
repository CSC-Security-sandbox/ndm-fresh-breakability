import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RedisService } from "src/redis/redis.service";
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class RedisMemoryCheckActivity {
  private readonly memoryUsageThreshold: number;
  private readonly logger: LoggerService;

  constructor(
    private readonly redisService: RedisService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    this.memoryUsageThreshold = this.configService.get<number>('worker.redisMemoryUsageThreshold', 90);
    this.logger = loggerFactory.create(RedisMemoryCheckActivity.name);
  }

    /**
     * Check Redis memory usage
     * @returns {Promise<boolean>} - Returns true if memory usage is below 90%, false otherwise
     */
  async checkMemoryUsage(): Promise<boolean> {
    try {
      const memoryInfo = await this.redisService.getMemoryInfo();
      const memoryUsagePercentage = (memoryInfo.used_memory/ memoryInfo.total_system_memory) * 100;
      this.logger.log(`Redis Memory Usage : ${JSON.stringify(memoryInfo)}`);
      return memoryUsagePercentage < this.memoryUsageThreshold;      
    } catch (error) {
      this.logger.error(`Error fetching Redis memory info: ${error}`);
      throw error;
    }
  }
}