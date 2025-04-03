import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { WorkersConfig } from 'src/config/app.config';
import { RedisService } from 'src/redis/redis.service';

@Injectable()
export class SpeedTestActivity {
  readonly workerId: string;
  readonly reportServiceUrl: string;
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    private readonly logger: Logger,
    private readonly redisService: RedisService,
  ) {
    this.workerId = this.configService.get('worker.workerId');
    this.reportServiceUrl = this.configService.get('worker.workerReportServiceUrl');
  }
  

  async speedTestStatusUpdate(traceId: string, status: string): Promise<any> {
    try {
      const workerJobServiceUrl = WorkersConfig.get('workerJobServiceUrl');
      this.logger.log(`[${traceId}] Updating Speed Test status to ${status}`);
      await axios.patch(`${workerJobServiceUrl}/api/v1/job-run/${traceId}/${status}`);
      this.logger.log(`[${traceId}] Speed Test status updated to ${status}`);
      return { message: 'Speed Test Job status updated as completed for job id: ' + traceId };
    } catch (error) {
      this.logger.error(`[${traceId}] Failed to update Speed Test status: ${error}`);
      return { message: 'Error while updating the satus of the job id : ' + traceId };
    }
  }

}

