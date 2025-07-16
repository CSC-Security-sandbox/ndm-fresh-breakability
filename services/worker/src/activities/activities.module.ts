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
import { ShellService } from './common/shell.service';
import { WorkerThreadModule } from 'src/thread/worker.thread.module';
import { SpeedTestActivities } from './speed-test/speed-test-activities';
import { AuthModule } from 'src/auth/auth.module';
import { RedisMemoryCheckActivity } from './redis/redis.mem.usage.check.activity';
import {MigrateScanService} from './core/scan/migrate/migrate-scan.service';
import { MigrateSyncService } from './core/migrate/migrate-sync.service';
import { CommonTaskService } from './core/common/common-task.service';
import { DiscoveryScanService } from './core/scan/discovery/discovery-scan.service';
import { ScanService } from './core/scan/scan-activity.service';
import { ValidatePathActivity } from './validate-path/validate-path.service';


@Module({
  imports: [HttpModule, ConfigModule, WorkerThreadModule, AuthModule],
  controllers: [],
  providers: [ValidateConnectionActivity, ListPathActivity, DiscoveryActivity, RedisService, DiscoveryScanActivity, SetupActivityService, MigrationScanService, MigrationTaskService, MigrationSyncService, MigrateSyncService,MigrateScanService, Logger, ValidateWorkingDirectoryActivity,PrecheckActivity, CommonActivityService, ShellService , SpeedTestActivities, RedisMemoryCheckActivity,  CommonTaskService, DiscoveryScanService, ScanService, ValidatePathActivity],
  exports:  [ValidateConnectionActivity, ListPathActivity, DiscoveryActivity, RedisService, DiscoveryScanActivity, SetupActivityService, MigrationTaskService,MigrationScanService, MigrationSyncService, MigrateSyncService, MigrateScanService,  ValidateWorkingDirectoryActivity,PrecheckActivity, CommonActivityService, ShellService , SpeedTestActivities,RedisMemoryCheckActivity, CommonTaskService, DiscoveryScanService, ScanService, ValidatePathActivity],
})
export class ActivitiesModule {}