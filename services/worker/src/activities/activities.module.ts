import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisService } from 'src/redis/redis.service';
import { ListPathActivity } from './list-path/list-path.service';
import { SetupActivityService } from './setup-worker/setup.activity.service';
import { ValidateConnectionActivity } from './validate-connection/validate-connection.service';
import { ValidateWorkingDirectoryActivity } from './working-directory/working-directory.service';
import { PrecheckActivity } from './precheck/precheck-activity';
import { CommonActivityService } from './common/common.service';
import { WorkerThreadModule } from 'src/thread/worker.thread.module';
import { SpeedTestActivities } from './speed-test/speed-test-activities';
import { AuthModule } from 'src/auth/auth.module';
import { RedisMemoryCheckActivity } from './redis/redis.mem.usage.check.activity';
import { MigrateScanService } from './core/scan/migrate/migrate-scan.service';
import { CommonTaskService } from './core/common/common-task.service';
import { DiscoveryScanService } from './core/scan/discovery/discovery-scan.service';
import { ScanService } from './core/scan/scan-activity.service';
import { ValidatePathActivity } from './validate-path/validate-path.service';
import { ProtocolsModule } from '../protocols/protocols.module'; 
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { CommandExecService } from './core/migrate/command-execution/command-execution.service';
import { SyncService } from './core/migrate/sync-activity.service';
import { StampMetaService } from './core/migrate/command-execution/stamp-meta.service';
import { StampAtimeService } from './core/migrate/command-execution/stamp-atime.service';
import { WinShellService } from './common/win-shell.service';
import { WinOperationService } from './core/migrate/command-execution/win-opeartions/win-operation.service';
import { MappingResolverService } from './core/initializer/mapping-resolver.service';
import { SetupExportsPathPermissionService } from './core/initializer/setup-exports-path-permission.service';
import { FileTypeDetectionService } from './core/utils/file-type-detection.service';
import { StorageClientFactory } from 'src/storage-clients/storage-client.factory';
import { FetchFailedOperationsActivity } from './core/retry/fetch-failed-operations.activity';
import { ProcessRetryBatchActivity } from './core/retry/process-retry-batch.activity';
import { CommandGenerationService } from './core/shared/command-generation.service';
import { DirStreamingService } from './core/shared/dir-streaming.service';
import { MetricsModule } from 'src/metrics/metrics.module';
import { UpgradeActivityModule } from './upgrade/upgrade.activity.module';

@Module({
  imports: [LoggerModule.forRoot(), HttpModule, ConfigModule, WorkerThreadModule, AuthModule, ProtocolsModule, UpgradeActivityModule, MetricsModule],
  controllers: [],
  providers: [ValidateConnectionActivity, ListPathActivity,  RedisService,  SetupActivityService, FileTypeDetectionService, MigrateScanService, ValidateWorkingDirectoryActivity,PrecheckActivity, CommonActivityService, SpeedTestActivities, RedisMemoryCheckActivity,  CommonTaskService, DiscoveryScanService, ScanService, SyncService, CommandExecService, StampMetaService, StampAtimeService, ValidatePathActivity, WinShellService, WinOperationService, MappingResolverService, SetupExportsPathPermissionService, StorageClientFactory, FetchFailedOperationsActivity, ProcessRetryBatchActivity, CommandGenerationService, DirStreamingService],
  exports:  [ValidateConnectionActivity, ListPathActivity,  RedisService,  SetupActivityService,  FileTypeDetectionService, MigrateScanService,  ValidateWorkingDirectoryActivity,PrecheckActivity, CommonActivityService, SpeedTestActivities,RedisMemoryCheckActivity, CommonTaskService, DiscoveryScanService, ScanService, SyncService, CommandExecService, StampMetaService, StampAtimeService, ValidatePathActivity, WinShellService, WinOperationService, MappingResolverService, SetupExportsPathPermissionService, StorageClientFactory, FetchFailedOperationsActivity, ProcessRetryBatchActivity, CommandGenerationService, UpgradeActivityModule, DirStreamingService],
})
export class ActivitiesModule {}
