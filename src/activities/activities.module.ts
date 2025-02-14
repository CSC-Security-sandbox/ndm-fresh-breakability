import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ValidateConnectionActivity } from './validate-connection/validate-connection.service';
import { ListPathActivity } from './list-path/list-path.service';
import { LoggerModule } from 'src/logger/logger.module';
import { ConfigModule } from '@nestjs/config';
import { DiscoveryActivity } from './discovery/discovery.activities';
import { RedisService } from 'src/redis/redis.service';
import { WorkerService } from './workers/worker.service';


@Module({
  imports: [HttpModule, LoggerModule, ConfigModule],
  controllers: [],
  providers: [ValidateConnectionActivity, ListPathActivity, DiscoveryActivity, RedisService, WorkerService],
  exports: [ ValidateConnectionActivity, ListPathActivity, DiscoveryActivity, RedisService, WorkerService],
})
export class ActivitiesModule {}