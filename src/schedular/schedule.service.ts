import { Between } from 'typeorm';
import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { JobConfigService } from '../jobconfig/jobconfig.service';
import { JobRunService } from '../jobrun/jobrun.service';
import { RabbitMqService } from '../events/rabbitmq.service';
import { TaskService } from '../tasks/tasks.service';
import { TaskOperation, TaskStatus, TaskType } from './../entities/task.entity';
import { WorkersService } from './../workers/workers.service';
import { JobRunStatus } from '../entities/jobrun.entity';
import { EventsGateway } from '../events/events.gateway';

@Injectable()
export class SchedularService {
  private readonly logger = new Logger(SchedularService.name);
  
  constructor (
    private readonly jobConfigService: JobConfigService,
    private readonly jobRunService: JobRunService,
    private rabbitMqService: RabbitMqService,
    private readonly taskService: TaskService,
    private workerService: WorkersService,
    private eventsGateway: EventsGateway
  ) {}

  async handleCron(): Promise<string> {
    const currentTime = new Date();
    const timeWindow = 5 * 60 * 1000;
    const windowStart = new Date(currentTime.getTime() - timeWindow);
    const windowEnd = new Date(currentTime.getTime() + timeWindow);
    const jobs = await this.jobConfigService.getJobs({ where: { status: 'Active', schedule_time: Between(windowStart, windowEnd) }});

    for (const job of jobs) {
      // create a job run for this job configuration
      const jobRun = await this.jobRunService.createJobRun({
        id: uuid(),
        status: JobRunStatus.Ready,
        start_time: currentTime,
        end_time: null,
        iteration_number: 1,
        job_id: job.id
      });
      this.logger.log(`Job run created for job ID: ${job.id} at ${currentTime}`);

      // create a initial task data for this job.
      const task = {
        id: uuid(),
        jobRunId: jobRun.id,
        taskType: TaskType.Scan, // taskType will be dynamic based on jobrun data
        status: TaskStatus.Pending,
        transactionId: '',
        fileServerId: job.file_server_id, // not needed
        operations: [{
          operation: TaskOperation.ScanPath, // operation will be dynamic based on jobrun data
          request: {
            pathId: job.path_id, // absolute path /etc/mnt/path_id/folder
            folder: '' // relative path
          },
          status: TaskStatus.Pending
        }]
      }

      // save this task to database [Task Entity]
      const taskRecord = await this.taskService.create(task);
      
      // publish this initial task to rabbitmq 
      this.rabbitMqService.publishToExchange(taskRecord);
      
      // send worker wakeup command
      const workers = await this.workerService.findAllWorkers({  });

      for (let index = 0; index < workers.total; index++) {
        await this.eventsGateway.sendToClient(workers.data[index], 'WAKE_UP', { message: 'wakeup' });
      }
    }
    return 'success';
  }
}