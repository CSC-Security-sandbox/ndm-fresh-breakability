import { Injectable } from '@nestjs/common';
import { ConfigObject, ConfigService, registerAs } from '@nestjs/config';

// Platform constants
export const WINDOWS = 'win32';

export default registerAs(
  'worker',
  (): ConfigObject => ({
    workerId: process.env.WORKER_ID || '6cf21220-5627-4614-a947-778915dba29f',
    buildId: process.env.BUILD_ID || '1.0.0',
    baseWorkingPath: process.env.BASE_WORKING_PATH || '/mnt/datamigrate',
    platform: process.platform,
    // connection
    connection: {
      workerConfigUrl: process.env.WORKER_CONFIG_URL || 'http://localhost:3002',
      workerReportServiceUrl: process.env.WORKER_REPORT_SERVICE_URL || 'http://localhost:3003',
      workerJobServiceUrl: process.env.WORKER_JOB_SERVICE_URL || 'http://localhost:3006',
    },

    healthCheckInterval: process.env.HEALTH_CHECK_INTERVAL || '5',
    checkSpaceForPreCheck: process.env.CHECK_AVAILABLE_DISK_SPACE === 'true',
    otelCollectorEndPoint: process.env.OTEL_COLLECTOR_ENDPOINT || 'localhost:4318',

    //core operations
    maxRetryCount: parseInt(process.env.MAX_OPERATION_RETRY || '3'),
    maxMigrationCommand: parseInt(process.env.MAX_MIGRATION_COMMAND || '100'),
    retryFetchBatchSize: parseInt(process.env.RETRY_FETCH_BATCH_SIZE || '4000'),
    maxScanCommand: parseInt(process.env.MAX_SCAN_COMMAND || '500'),
    migrationTaskStreamLimit: parseInt(process.env.MIGRATION_TASK_LIMIT || '100'),
    migrationChunkSize: parseInt(process.env.CHUNK_SIZE || '1048576'),
    maxCommandConcurrency: parseInt(process.env.MAX_COMMAND_CONCURRENCY || '100'),
    maxWriteConcurrency: parseInt(process.env.MAX_WRITE_CONCURRENCY || '100'),
    operationTimeout: parseInt(process.env.OPERATION_TIMEOUT || '5000'),
    groupSize: parseInt(process.env.REDIS_STREAM_GROUP_SIZE || '1000'),
    commandsInTask: parseInt(process.env.COMMANDS_IN_TASK || '100'),
    maxCmdStreamLen: parseInt(process.env.MAX_CMDS_IN_STREAM || '5000'),
    metaUpdatedToleranceMs: parseInt(process.env.META_UPDATED_TOLERANCE_MS || '30000'),
    dirStreamBatchSize: parseInt(process.env.DIR_STREAM_BATCH_SIZE || '5000'),

    // speed test
    speedTestFileName: process.env.SPEED_TEST_FILE_NAME || '1GB_zero_file.bin',
    speedTestFileSize: parseFloat(process.env.SPEED_TEST_FILE_Size_GB || '1'),
    speedTestTimeout: parseInt(process.env.SPEED_TEST_TIMEOUT || '120000'),

    // redis and temporal 
    redisMemoryUsageThreshold: parseInt(process.env.REDIS_MEM_USAGE_THRESHOLD || '90'),
    maxActivityConcurrency: parseInt(process.env.JOB_TASK_ACTIVITY_CONCURRENCY || '1'),
    maxActivityTaskPollers: parseInt(process.env.MAX_ACTIVITY_TASK_POLLERS || '0'),
    workerStartupTimeout: parseInt(process.env.WORKER_STARTUP_TIMEOUT || '2000'),
    shutDownForceTime: process.env.WORKER_SHUTDOWN_FORCE_TIME || '10s',

    // project id
    projectId: process.env.PROJECT_ID || 'no-project-id-found',

    // thread pool
    thread: {
      threadBand: process.env.THREAD_BANDS || '1kb,1500;1mb,1000;10mb,100;100mb,10;1gb,1',
      threadCount: parseInt(process.env.THREAD_COUNT || '5'),
      maxBufferSize: parseInt(process.env.MAX_BUFFER_SIZE) || 1048576,
    },

    // metrics
    metrics: {
      versionsPathWindows: process.env.VERSIONS_PATH_WINDOWS || 'C:\\datamigrator\\conf\\versions.conf',
      versionsPathLinux: process.env.VERSIONS_PATH_LINUX || '/opt/datamigrator/conf/versions.conf',
      additionalMetrics: process.env.ADDITIONAL_METRICS || 'false',
    },

    // upgrade paths
    upgrade: {
      baseDirWindows: process.env.UPGRADE_BASE_DIR_WINDOWS || 'C:\\datamigrator',
      baseDirLinux: process.env.UPGRADE_BASE_DIR_LINUX || '/opt/datamigrator',
      confDirWindows: process.env.UPGRADE_CONF_DIR_WINDOWS || 'C:\\datamigrator\\conf',
      confDirLinux: process.env.UPGRADE_CONF_DIR_LINUX || '/opt/datamigrator/conf',
      stagingDirWindows: process.env.UPGRADE_STAGING_DIR_WINDOWS || 'C:\\datamigrator\\staging',
      stagingDirLinux: process.env.UPGRADE_STAGING_DIR_LINUX || '/opt/datamigrator/staging',
    },
  }),
);

@Injectable()
export class WorkersConfig {
  static configService: ConfigService;

  constructor(configService: ConfigService) {
    WorkersConfig.configService = configService;
  }

  static get(key: string): any {
    return WorkersConfig.configService.get(`worker.${key}`);
  }
}
