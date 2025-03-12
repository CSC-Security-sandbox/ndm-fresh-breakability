import { HttpModule } from '@nestjs/axios';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisService } from 'src/redis/redis.service';
import { DiscoveryScanActivity } from './discovery/discovery.core.activity';
import { DiscoveryActivity } from './discovery/discovery.activities';
import { ListPathActivity } from './list-path/list-path.service';
import { MigrationScanService } from './migrate/migrate.scan.service';
import { MigrationSyncService } from './migrate/migrate.sync.service';
import { MigrationTaskService } from './migrate/migrate.taskmanager.service';
import { SetupActivityService } from './setup-worker/setup.activity.service';
import { ValidateConnectionActivity } from './validate-connection/validate-connection.service';
import { ValidateWorkingDirectoryActivity } from './working-directory/working-directory.service';
import { PrecheckActivity } from './precheck/precheck-activity';
import { CommonActivityService } from './common/common.service';


@Module({
  imports: [HttpModule, ConfigModule],
  controllers: [],
  providers: [ValidateConnectionActivity, ListPathActivity, DiscoveryActivity, RedisService, DiscoveryScanActivity, SetupActivityService, MigrationScanService, MigrationTaskService, MigrationSyncService, Logger, ValidateWorkingDirectoryActivity,PrecheckActivity, CommonActivityService],
  exports:  [ValidateConnectionActivity, ListPathActivity, DiscoveryActivity, RedisService, DiscoveryScanActivity, SetupActivityService, MigrationTaskService,MigrationScanService, MigrationSyncService, ValidateWorkingDirectoryActivity,PrecheckActivity, CommonActivityService],
})
export class ActivitiesModule {}