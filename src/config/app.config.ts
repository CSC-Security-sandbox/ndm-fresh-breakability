import { Injectable } from '@nestjs/common';
import { ConfigObject, ConfigService, registerAs } from '@nestjs/config';

export default registerAs(
  'worker',
  (): ConfigObject => ({
    shutdownTimeout: process.env.SHUTDOWN_TIMEOUT || 5000,
    workerShutdownTimeout: process.env.WORKER_SHUTDOWN_TIMEOUT || 5000,
    workerId: process.env.WORKER_ID || '6cf21220-5627-4614-a947-778915dba29f',
    buildId: process.env.BUILD_ID || '1.0.0',
    workerConfigUrl:
      process.env.WORKER_CONFIG_URL ||
      'http://localhost:3002',
    workerReportServiceUrl:
      process.env.WORKER_REPORT_SERVICE_URL ||
      'http://localhost:3003',
    workerJobServiceUrl:
      process.env.WORKER_JOB_SERVICE_URL ||
      'http://localhost:3006',
    platform: process.platform,
    baseWorkingPath: process.env.BASE_WORKING_PATH || '/mnt/datamigrate',
    maxRetryCount: process.env.MAX_OPERATION_RETRY || 3,
    maxMigrationCommand: process.env.MAX_MIGRATION_COMMAND || 100,
    scanTaskDirBatch : process.env.SCAN_TASK_DIR_BATCH || 500,
    fetchTaskBatchMigration: process.env.FETCH_TASK_BATCH_MIGRATION || 1,
    maxConcurrency: process.env.MAX_CONCURRENCY || 100,
    threadCount: process.env.THREAD_COUNT || 5,
    speedTestFileName: process.env.SPEED_TEST_FILE_NAME || '1GB_zero_file.bin',
    speedTestFileSize: process.env.SPEED_TEST_FILE_Size_GB || 1,
    speedTestTimeout: process.env.SPEED_TEST_TIMEOUT || 120000,
    healthCheckInterval: process.env.HEALTH_CHECK_INTERVAL || 5,
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
