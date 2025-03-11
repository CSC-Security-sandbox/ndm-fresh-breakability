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
    maxRetryCount: process.env.MAX_OPERATION_RETRY || 3
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
