import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuid4 } from '@temporalio/workflow';
import { Command, JobContextFactory, RedisUtils, Task } from '@netapp-cloud-datamigrate/jobs-lib';
import { FetchScanTaskInput, FetchScanTaskOutPut, PublishScanTaskInput, PublishScanTaskOutput } from './migrate.type';
import { ConfigService } from '@nestjs/config';
import { RedisService } from 'src/redis/redis.service';

@Injectable()
export class MigrationTaskService {

  readonly workerId: string;
  readonly fetchTaskBatch: number;
  readonly pushTaskDirSize: number;
  
  constructor(
      @Inject(ConfigService) private readonly configService: ConfigService,
      private readonly logger: Logger,
      private readonly redisService: RedisService,
  ) {
      this.workerId = this.configService.get('worker.workerId');
      this.fetchTaskBatch = 50, this.pushTaskDirSize = 500;
  }

  async publishScanTask({ jobRunId }: PublishScanTaskInput): Promise<PublishScanTaskOutput> {
    try {
      const jobContext = await this.redisService.getJobContext(jobRunId);
      this.logger.log(`[${jobRunId}] JobContext retrieved. Processing files.`);
     
      let commands:Command[] = [], ops = { 0: { cmd: 'SCAN', status: 'PENDING' } };

      let counter = 0;

      for await (const dir of jobContext.groupReadDirs(jobRunId, this.pushTaskDirSize)) {
        counter++;
        if (counter > this.pushTaskDirSize) {
          this.logger.debug(`Breaking the loop of publish task for jobRunId: ${jobRunId}`);
          break;
        }
        const command = new Command(dir.path, ops, `cmd-${uuid4()}`);
        commands.push(command);
        if (commands && commands.length >= this.pushTaskDirSize) {
          const task = new Task(
            uuid4(),
            jobRunId,
            'SCAN',
            'PENDING',
            'worker-1',
            '/Users/calfus-kunalavghade/Desktop/node-fs/test1',
            commands,
            '/Users/calfus-kunalavghade/Desktop/node-fs/test2',
            ''
          )
          const id = await jobContext.appendToTaskList(task);
          jobContext.tasksInfo.lastId = id;
          await this.redisService.setJobContext(jobRunId, jobContext.serialize());
          commands = [];
        }
      }
      
      if (commands.length > 0) {
        const task = new Task(
          uuid4(),
          jobRunId,
          'SCAN',
          'PENDING',
          'worker-1',
          '/Users/calfus-kunalavghade/Desktop/node-fs/test1',
          commands,
          '/Users/calfus-kunalavghade/Desktop/node-fs/test2',
          ''
        )
        const id = await jobContext.appendToTaskList(task);
        jobContext.tasksInfo.lastId = id;
        await this.redisService.setJobContext(jobRunId, jobContext.serialize());
      }
      return { jobRunId, status: 'success', message: 'Task published successfully' };
    } catch (error) {
      this.logger.error(`[${jobRunId}] Error in publishing task: ${error.message}`);
      return {
        jobRunId,
        status: 'error',
        message: `Failed to publish task for Job run id ${jobRunId} : ${error}`,
    };
    }
  }


  async fetchScanTask({ jobRunId }: FetchScanTaskInput): Promise<FetchScanTaskOutPut> {
    const output: FetchScanTaskOutPut = { tasks: [] };
    try {
      const jobContext = await this.redisService.getJobContext(jobRunId);
      const tasks = await jobContext.groupReadTasks(jobRunId, this.fetchTaskBatch);
      for await (const task of tasks) output.tasks.push(task);
      return output;
    } catch (error) {
      this.logger.error(`[${jobRunId}] Failed to fetch the task: ${error}`);
      return output;
    }
  }
}