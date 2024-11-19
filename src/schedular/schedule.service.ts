import { Between } from 'typeorm';
import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { JobConfigService } from '../jobconfig/jobconfig.service';
import { JobRunService } from '../jobrun/jobrun.service';

@Injectable()
export class SchedularService {
  private readonly logger = new Logger(SchedularService.name);
  
  constructor (
    private readonly jobConfigService: JobConfigService,
    private readonly jobRunService: JobRunService,
  ) {}

  async handleCron(): Promise<string> {
    const currentTime = new Date();
    const timeWindow = 5 * 60 * 1000;
    const windowStart = new Date(currentTime.getTime() - timeWindow);
    const windowEnd = new Date(currentTime.getTime() + timeWindow);
    const jobs = await this.jobConfigService.getJobs({ where: { status: 'Active', schedule_time: Between(windowStart, windowEnd) }});

    for (const job of jobs) {
      await this.jobRunService.createJobRun({
        id: uuid(),
        status: 'RUNNING',
        start_time: currentTime,
        end_time: null,
        iteration_number: 1,
        job_id: job.id
      });
      this.logger.log(`Job run created for job ID: ${job.id} at ${currentTime}`);
    }
    return 'success';
  }
}