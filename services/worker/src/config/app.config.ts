import { Injectable } from '@nestjs/common';
import { ConfigObject, ConfigService, registerAs } from '@nestjs/config';

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

    //core operations
    maxRetryCount: parseInt(process.env.MAX_OPERATION_RETRY || '3'),
    maxMigrationCommand: parseInt(process.env.MAX_MIGRATION_COMMAND || '100'),
    maxScanCommand: parseInt(process.env.MAX_SCAN_COMMAND || '500'),
    migrationTaskStreamLimit: parseInt(process.env.MIGRATION_TASK_LIMIT || '100'),
    migrationChunkSize: parseInt(process.env.CHUNK_SIZE || '1048576'),
    maxCommandConcurrency: parseInt(process.env.MAX_COMMAND_CONCURRENCY || '100'),
    operationTimeout: parseInt(process.env.OPERATION_TIMEOUT || '5000'),
    groupSize: parseInt(process.env.REDIS_STREAM_GROUP_SIZE || '1000'),
    commandsInTask: parseInt(process.env.COMMANDS_IN_TASK || '100'),

    // speed test
    speedTestFileName: process.env.SPEED_TEST_FILE_NAME || '1GB_zero_file.bin',
    speedTestFileSize: parseFloat(process.env.SPEED_TEST_FILE_Size_GB || '1'),
    speedTestTimeout: parseInt(process.env.SPEED_TEST_TIMEOUT || '120000'),

    // redis and temporal 
    redisMemoryUsageThreshold: parseInt(process.env.REDIS_MEM_USAGE_THRESHOLD || '90'),
    maxActivityConcurrency: parseInt(process.env.JOB_TASK_ACTIVITY_CONCURRENCY || '1'),

    // project id
    projectId: process.env.PROJECT_ID || 'no-project-id-found',

    // thread pool
    thread: {
      threadBand: process.env.THREAD_BANDS || '1kb,1500;1mb,1000;10mb,100;100mb,10;1gb,1',
      threadCount: parseInt(process.env.THREAD_COUNT || '5'),
    }
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
