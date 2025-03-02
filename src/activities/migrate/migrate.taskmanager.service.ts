import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Command, JobContext, OPS_CMD, OPS_STATUS, Task, TaskType } from '@netapp-cloud-datamigrate/jobs-lib';
import { uuid4 } from '@temporalio/workflow';
import { RedisService } from 'src/redis/redis.service';
import { FetchMigrationTaskInput, FetchScanTaskInput, FetchScanTaskOutPut, PublishScanTaskInput, PublishScanTaskOutput, UpdateCutOverStatusInput, UpdateStatusInput, UpdateStatusOutput } from './migrate.type';
import { buildTask, generateDummyFileEntry } from '../utils/utils';
import axios from 'axios';

@Injectable()
export class MigrationTaskService{

  readonly workerId: string;
  readonly fetchTaskBatch: number;
  readonly pushTaskDirSize: number;
  readonly workerJobServiceUrl: string;
  readonly reportServiceUrl: string;
  
  constructor(
      @Inject(ConfigService) private readonly configService: ConfigService,
      private readonly logger: Logger,
      private readonly redisService: RedisService,
  ) {
      this.workerId = this.configService.get('worker.workerId');
      this.workerJobServiceUrl = this.configService.get('worker.workerJobServiceUrl');
      this.reportServiceUrl = this.configService.get('worker.workerReportServiceUrl');
      this.fetchTaskBatch = 50, this.pushTaskDirSize = 500;
  }

  async publishScanTask({ jobRunId }: PublishScanTaskInput): Promise<PublishScanTaskOutput> {
    try {
      const jobContext:JobContext = await this.redisService.getJobContext(jobRunId);
      this.logger.log(`[${jobRunId}] JobContext retrieved. Processing files.`);
      let commands:Command[] = [], ops = { 0: { cmd: OPS_CMD.COPY_DIR, status: OPS_STATUS.READY } };
      for await (const dir of jobContext.groupReadDirs(`${jobRunId}-worker`, this.pushTaskDirSize)) {
        const command = new Command(dir.path, ops, uuid4());
        commands.push(command);
        if (commands && commands.length >= this.pushTaskDirSize) {
          const task = buildTask(TaskType.SCAN, jobRunId, jobContext, commands);
          const id = await jobContext.appendToTaskList(task);
          jobContext.tasksInfo.lastId = id;
          await this.redisService.setJobContext(jobRunId, jobContext);
          commands = [];
        }
      }
      
      if (commands.length > 0) {
        const task = buildTask(TaskType.SCAN, jobRunId, jobContext, commands);
        const id = await jobContext.appendToTaskList(task);
        jobContext.tasksInfo.lastId = id;
        await this.redisService.setJobContext(jobRunId, jobContext);
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
      const tasks = await jobContext.groupReadTasks('consumer-1', this.fetchTaskBatch);
      for await (const task of tasks) output.tasks.push(task);
      return output;
    } catch (error) {
      this.logger.error(`[${jobRunId}] Failed to fetch the task: ${error}`);
      return output;
    }
  }

  async fetchMigrationTask({ jobRunId }: FetchMigrationTaskInput): Promise<FetchScanTaskOutPut> {
    const output: FetchScanTaskOutPut = { tasks: [] };
    try {
      const jobContext = await this.redisService.getJobContext(jobRunId);
      const tasks = await jobContext.groupReadMigrationTask('consumer-1', this.fetchTaskBatch);
      for await (const task of tasks) output.tasks.push(task);
      return output;
    } catch (error) {
      this.logger.error(`[${jobRunId}] Failed to fetch the task: ${error}`);
      return output;
    }
  }

  async updateStatus({jobRunId, status}: UpdateStatusInput): Promise<UpdateStatusOutput> {
    try {

      this.logger.log(`[${jobRunId}] Updating status to URL ${this.workerJobServiceUrl}`);
      this.logger.log(`[${jobRunId}] Updating status to ${status}`);
      await axios.patch(`${this.workerJobServiceUrl}/${jobRunId}/${status}`);
      this.logger.log(`[${jobRunId}] status updated to ${status}`);
      return { message: 'Job status updated for job id: ' + jobRunId };
    } catch (error) {
      this.logger.error(`[${jobRunId}] Failed to update status: ${error}`);
      return { message: 'Error while updating the status of the job id : ' + jobRunId };
    }
  }

  async updateLastEntry(traceId: string): Promise<any> {
    try {
      this.logger.log(`[${traceId}] Publishing last entry for job id: ${traceId}`);
      const jobContext = await this.redisService.getJobContext(traceId);
      const id = await jobContext.appendToFileList(generateDummyFileEntry);
      jobContext.errorsInfo.lastId = id;
      this.redisService.setJobContext(traceId, jobContext);
      this.logger.log(`[${traceId}] Last entry published for job id: ${traceId}`);
      return { message: 'Job completed for job id: ' + traceId };
    } catch (error) {
      this.logger.error(`[${traceId}] Error while marking the job as completed : ${error}`);
      return { message: 'Error while marking the job as completed : ' + traceId };
    }
  }

  async updateCutOverStatus({jobRunId, status}: UpdateCutOverStatusInput): Promise<UpdateStatusOutput> {
    try {
      this.logger.log(`[${jobRunId}] Updating cutover status to URL ${this.workerJobServiceUrl}`);
      this.logger.log(`[${jobRunId}] Updating  cutover status to ${status}`);
      await axios.put(`${this.workerJobServiceUrl}/cutover/${jobRunId}/${status}`);
      this.logger.log(`[${jobRunId}] status updated to ${status}`);
      return { message: 'Job status updated for job id: ' + jobRunId };
    } catch (error) {
      this.logger.error(`[${jobRunId}] Failed to update status: ${error}`);
      return { message: 'Error while updating the status of the job id : ' + jobRunId };
    }
  }

  async generateCOCReport(jobRunId: string) {
    try {
      this.logger.log(`[${jobRunId}] reportServiceUrl to URL ${this.reportServiceUrl}`);
      this.logger.log(`[${jobRunId}] Triggering generateCOCReport`);
      await axios.get(`${this.reportServiceUrl}/job-run/coc-report/${jobRunId}`);
      this.logger.log(`[${jobRunId}] Triggering generateCOCReport successful`);
      return { message: 'Triggering generateCOCReport successful for job id: ' + jobRunId };
    } catch (error) {
      this.logger.error(`[${jobRunId}] Failed to Trigger generateCOCReport: ${error}`);
      return { message: 'Error while Triggering generateCOCReport for the job id : ' + jobRunId };
    }
  }

}