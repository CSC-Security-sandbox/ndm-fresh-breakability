import { HttpService } from '@nestjs/axios';
import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import {
  SystemStats,
  HealthcheckPayload,
  HealthStatus,
} from './healthcheck.types';
import { AuthService } from 'src/auth/auth.service';
import { CronJob } from 'cron';
import { SchedulerRegistry } from '@nestjs/schedule';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class HealthcheckService implements OnModuleInit {
  private readonly healthCheckInterval: number;
  private readonly workerId: string;
  private readonly workerJobServiceUrl: string;
  private readonly memoryLimitGb: number;
  private diskLimitGb: number = -1;
  private readonly logger: LoggerService;

  constructor(
    private readonly httpService: HttpService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly schedulerRegistry: SchedulerRegistry,
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject('totalmem') private readonly totalmem: () => number,
    @Inject('freemem') private readonly freemem: () => number,
    @Inject('cpu') private readonly cpu: any,
    @Inject('drive') private readonly drive: any,
    @Inject(AuthService) private readonly authService: AuthService,
  ) {
    this.healthCheckInterval = this.configService.get<number>(
      'worker.healthCheckInterval',
    );
    this.workerId = this.configService.get<string>('worker.workerId');
    this.workerJobServiceUrl = this.configService.get<string>(
      'worker.connection.workerJobServiceUrl',
    );
    this.memoryLimitGb = this.getSafeMemoryLimit();
    this.setupDiskLimit();
    this.logger = loggerFactory.create(HealthcheckService.name);
  }

  private getSafeMemoryLimit(): number {
    try {
      return this.totalmem() / (1024 * 1024 * 1024);
    } catch {
      return -1;
    }
  }

  private setupDiskLimit(): void {
    this.drive
      .info()
      .then((diskInfo: { totalGb: string }) => {
        this.diskLimitGb = parseFloat(diskInfo.totalGb);
      })
      .catch(() => {
        this.diskLimitGb = -1;
      });
  }

  async onModuleInit(): Promise<void> {
    const cronExpression = `*/${this.healthCheckInterval} * * * * *`;
    const job = new CronJob(cronExpression, () => {
      this.getPayloadAndToken().then(({ payload, accessToken }) => {
        this.postHealthcheckResults(payload, accessToken);
      });
    });
    this.schedulerRegistry.addCronJob('healthcheck', job);
    job.start();
  }

  async getPayloadAndToken(): Promise<{
    payload: HealthcheckPayload;
    accessToken: string;
  }> {
    try {
      const payload: HealthcheckPayload = await this.getHealthcheckPayload();
      const accessToken = await this.authService.getAccessToken();
      if (!accessToken) throw new Error('Failed to get access token');
      return { payload, accessToken };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error in getPayloadAndToken: ${errorMessage}`);
      throw error;
    }
  }

  private postHealthcheckResults(
    payload: HealthcheckPayload,
    accessToken: string,
  ): void {
    const url = `${this.workerJobServiceUrl}/api/v1/statscheck`;
    firstValueFrom(
      this.httpService.post(url, payload, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    ).catch((error) => {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
        this.logger.error(`Error in making statscheck API call: ${errorMessage}`);
    });
  }

  private async getCpuUsageAsync(): Promise<number> {
    try {
      return await this.cpu.usage();
    } catch {
      return -1;
    }
  }

  private getMemoryStats(): { memoryUsage: number; memoryLimit: number } {
    try {
      const freeMemGb = this.freemem() / (1024 * 1024 * 1024);
      const usedMemGb = this.memoryLimitGb - freeMemGb;
      const usagePercent = (usedMemGb / this.memoryLimitGb) * 100;
      return { memoryUsage: usagePercent, memoryLimit: this.memoryLimitGb };
    } catch {
      return { memoryUsage: -1, memoryLimit: -1 };
    }
  }

  private async getDiskStats(): Promise<{
    diskUsage: number;
    diskLimit: number;
  }> {
    try {
      const diskInfo = await this.drive.info();
      const freeGb = parseFloat(diskInfo.freeGb);
      const usedGb = this.diskLimitGb - freeGb;
      const usagePercent = (usedGb / this.diskLimitGb) * 100;
      return { diskUsage: usagePercent, diskLimit: this.diskLimitGb };
    } catch {
      return { diskUsage: -1, diskLimit: -1 };
    }
  }

  async getSystemStats(): Promise<SystemStats> {
    const [cpuValue, diskStats] = await Promise.all([
      this.getCpuUsageAsync(),
      this.getDiskStats(),
    ]);
    const memoryStats = this.getMemoryStats();
    return {
      cpuUsage: cpuValue === -1 ? '-1' : `${cpuValue.toFixed(2)}%`,
      memoryUsage:
        memoryStats.memoryUsage === -1
          ? '-1'
          : `${memoryStats.memoryUsage.toFixed(2)}%`,
      memoryLimit:
        memoryStats.memoryLimit === -1
          ? '-1'
          : `${memoryStats.memoryLimit.toFixed(2)}GB`,
      diskUsage:
        diskStats.diskUsage === -1
          ? '-1'
          : `${diskStats.diskUsage.toFixed(2)}%`,
      diskLimit:
        diskStats.diskLimit === -1
          ? '-1'
          : `${diskStats.diskLimit.toFixed(2)}GB`,
    };
  }

  async getHealthcheckPayload(): Promise<HealthcheckPayload> {
    const systemStats: SystemStats = await this.getSystemStats();
    return {
      workerId: this.workerId,
      healthStatus: HealthStatus.Healthy,
      systemStats,
    };
  }
}
