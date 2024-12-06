import { Between } from 'typeorm';
import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { JobConfigService } from '../jobconfig/jobconfig.service';
import { JobRunService } from '../jobrun/jobrun.service';
import { TaskService } from '../tasks/tasks.service';
import { TaskOperation, TaskStatus, TaskType } from './../entities/task.entity';
import { WorkersService } from './../workers/workers.service';
import { EventsGateway } from '../events/getway/events.gateway';
import { JobRunStatus } from 'src/entities/jobrun.entity';
// import { JobStatus } from 'src/entities/jobconfig.entity';

@Injectable()
export class SchedularService {
  private readonly logger = new Logger(SchedularService.name);
  
  constructor (
    private readonly jobConfigService: JobConfigService,
    private readonly jobRunService: JobRunService,
    private readonly taskService: TaskService,
    private workerService: WorkersService,
    private eventsGateway: EventsGateway
  ) {}

  async handleCron(): Promise<string> {
    const currentTime = new Date();
    // const jobs = await this.jobConfigService.getJobConfigsForCreatingJobRun();

    // for (const job of jobs) {

      /*
      // create a job run for this job configuration
      const jobRun = await this.jobRunService.createJobRun({
        id: uuid(),
        status: JobRunStatus.Ready,
        startTime: currentTime,
        endTime: null,
        iterationNumber: 1,
        jobConfigId: job.id
      });
      this.logger.log(`Job run created for job ID: ${job.id} at ${currentTime}`);
      // create a initial task data for this job.
      const task = {
        jobRunId: jobRun.id,
        taskType: job.jobType as unknown as TaskType,
        status: TaskStatus.Pending,
        operations: [{
          operation: TaskOperation.ScanPath, // operation will be dynamic based on jobrun data
          request: {
            pathId: '/etc/mnt/unique-mount-path', // absolute path /etc/mnt/path_id/folder
            folder: '/' // relative path
          },
          status: TaskStatus.Pending
        }]
      }
      // save this task to database [Task Entity]
      await this.taskService.create(task);
      // send worker wakeup command
      const workers = await this.workerService.findAllWorkers({ workerId: '8a76f6a2-8c1d-4c3c-bdbc-839a5ede4587' });
      for (let index = 0; index < workers.total; index++) {
        await this.eventsGateway.sendToClient(workers.data[index].workerId, 'WAKE_UP', { message: 'wakeup', jobRunId: jobRun.id });
      }
    }
    */
    return 'success';
  }
}