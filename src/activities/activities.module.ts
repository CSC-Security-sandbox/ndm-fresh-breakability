import { HttpModule } from '@nestjs/axios';
import { Logger, Module } from '@nestjs/common';
import { ValidateConnectionActivity } from './validate-connection/validate-connection.service';
import { ListPathActivity } from './list-path/list-path.service';
import { LoggerModule } from 'src/logger/logger.module';
import { ConfigModule } from '@nestjs/config';
import { DiscoveryActivity } from './discovery/discovery.activities';
import { RedisService } from 'src/redis/redis.service';
import { DiscoveryScanActivity } from './discovery/discovery-scan-activities';
import { SetupActivityService } from './setup-worker/setup.activity';


@Module({
  imports: [HttpModule, LoggerModule, ConfigModule],
  controllers: [],
  providers: [ValidateConnectionActivity, ListPathActivity, DiscoveryActivity, RedisService, DiscoveryScanActivity, SetupActivityService, Logger],
  exports:  [ValidateConnectionActivity, ListPathActivity, DiscoveryActivity, RedisService, DiscoveryScanActivity, SetupActivityService],
})
export class ActivitiesModule {}