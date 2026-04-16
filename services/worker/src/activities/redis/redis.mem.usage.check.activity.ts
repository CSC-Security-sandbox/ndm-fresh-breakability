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
     * Check Redis memory usage against maxmemory (falls back to total_system_memory if maxmemory is not set)
     * @returns {Promise<boolean>} - Returns true if memory usage is below threshold, false otherwise
     */
  async checkMemoryUsage(): Promise<boolean> {
    try {
      const memoryInfo = await this.redisService.getMemoryInfo();
      const memoryLimit = memoryInfo.maxmemory > 0 ? memoryInfo.maxmemory : memoryInfo.total_system_memory;
      const memoryUsagePercentage = (memoryInfo.used_memory / memoryLimit) * 100;
      this.logger.log(`Redis Memory Usage: ${memoryUsagePercentage.toFixed(1)}% (${memoryInfo.used_memory} / ${memoryLimit}) threshold: ${this.memoryUsageThreshold}%`);
      return memoryUsagePercentage < this.memoryUsageThreshold;
    } catch (error) {
      this.logger.error(`Error fetching Redis memory info: ${error}`);
      throw error;
    }
  }
}