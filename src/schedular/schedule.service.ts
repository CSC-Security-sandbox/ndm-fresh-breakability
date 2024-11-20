import { Between } from 'typeorm';
import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { JobConfigService } from '../jobconfig/jobconfig.service';
import { JobRunService } from '../jobrun/jobrun.service';
import { RabbitMqService } from '../events/rabbitmq.service';

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
    const timeWindow = 5 * 60 * 1000;
    const windowStart = new Date(currentTime.getTime() - timeWindow);
    const windowEnd = new Date(currentTime.getTime() + timeWindow);
    const jobs = await this.jobConfigService.getJobs({ where: { status: 'Active', schedule_time: Between(windowStart, windowEnd) }});

    for (const job of jobs) {
      const jobRun = await this.jobRunService.createJobRun({
        id: uuid(),
        status: 'RUNNING',
        start_time: currentTime,
        end_time: null,
        iteration_number: 1,
        job_id: job.id
      });
      this.logger.log(`Job run created for job ID: ${job.id} at ${currentTime}`);
      this.rabbitMqService.publishToExchange({
        id: uuid(),
        jobRunId: jobRun.id,
        taskType: 'SCAN',
        status: 'PENDING',
        transactionId: '',
        fileServerId: job.file_server_id,
        operations: [{
          operation: 'SCAN_PATH',
          request: {
            pathId: job.path_id,
            folder: ''
          },
          status: 'PENDING'
        }]
      });
    }
    return 'success';
  }
}