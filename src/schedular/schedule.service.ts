import { Between } from 'typeorm';
import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { JobConfigService } from '../jobconfig/jobconfig.service';
import { JobRunService } from '../jobrun/jobrun.service';
import { RabbitMqService } from '../events/service/rabbitmq.service';
import { JobStatus } from 'src/entities/jobconfig.entity';
import { JobRunStatus } from 'src/entities/jobrun.entity';

@Injectable()
export class SchedularService {
  private readonly logger = new Logger(SchedularService.name);
  
  constructor (
    private readonly jobConfigService: JobConfigService,
    private readonly jobRunService: JobRunService,
    private rabbitMqService: RabbitMqService,
  ) {}

  async handleCron(): Promise<string> {
    const currentTime = new Date();
    const jobs = await this.jobConfigService.getJobConfigs({ where: { status: JobStatus.Active }});

    for (const job of jobs) {
      const jobRun = await this.jobRunService.createJobRun({
        id: uuid(),
        status: JobRunStatus.Running,
        startTime: currentTime,
        endTime: null,
        iterationNumber: 1,
        jobConfigId: job.id
      });
      this.logger.log(`Job run created for job ID: ${job.id} at ${currentTime}`);
      this.rabbitMqService.publishToExchange({
        id: uuid(),
        jobRunId: jobRun.id,
        taskType: 'SCAN',
        status: 'PENDING',
        transactionId: '',
        operations: [{
          operation: 'SCAN_PATH',
          request: {
            pathId: job.sourcePathId,
            folder: ''
          },
          status: 'PENDING'
        }]
      });
    }
    return 'success';
  }
}