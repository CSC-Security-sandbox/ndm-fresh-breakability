import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Command, GroupReaderType, JobContext, OPS_CMD, OPS_STATUS, TaskType } from '@netapp-cloud-datamigrate/jobs-lib';
import { uuid4 } from '@temporalio/workflow';
import axios from 'axios';
import { AuthService } from 'src/auth/auth.service';
import { RedisService } from 'src/redis/redis.service';
import { buildTask } from '../utils/utils';
import { FetchMigrationTaskInput, FetchScanTaskInput, FetchScanTaskOutPut, PublishScanTaskInput, PublishScanTaskOutput, UpdateCutOverStatusInput, UpdateStatusOutput } from './migrate.type';

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
      private readonly httpService: HttpService,
      private readonly authService: AuthService,
  ) {
      this.workerId = this.configService.get('worker.workerId');
      this.workerJobServiceUrl = this.configService.get('worker.workerJobServiceUrl');
      this.reportServiceUrl = this.configService.get('worker.workerReportServiceUrl');
      this.fetchTaskBatch =  this.configService.get('worker.fetchTaskBatchMigration') || 1;;
      this.pushTaskDirSize = this.configService.get('worker.scanTaskDirBatch') || 500;
  }

  async publishScanTask({ jobRunId }: PublishScanTaskInput): Promise<PublishScanTaskOutput> {
    try {
      const jobContext:JobContext = await this.redisService.getJobContext(jobRunId);
      this.logger.log(`[${jobRunId}] JobContext retrieved. Processing files.`);
      let commands:Command[] = [], ops = { 0: { cmd: OPS_CMD.COPY_DIR, status: OPS_STATUS.READY } };
      for await (const dir of jobContext.readDirs(this.workerId, this.pushTaskDirSize, GroupReaderType.WORKER)) {
        const command = new Command(dir.path, ops, uuid4(), 0);
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
      const tasks = await jobContext.groupReadTasks(this.workerId, this.fetchTaskBatch, GroupReaderType.WORKER);
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
      const tasks = await jobContext.groupReadMigrationTask(this.workerId, this.fetchTaskBatch, GroupReaderType.WORKER);
      for await (const task of tasks) output.tasks.push(task);
      return output;
    } catch (error) {
      this.logger.error(`[${jobRunId}] Failed to fetch the task: ${error}`);
      return output;
    }
  }

  async generateCOCReport(jobRunId: string) {
    try {
      this.logger.log(`[${jobRunId}] reportServiceUrl to URL ${this.reportServiceUrl}/api/v1/report`);
      this.logger.log(`[${jobRunId}] Triggering generateCOCReport for url : ${this.reportServiceUrl}/api/v1/report/job-run/coc-report/${jobRunId}`);
      const accessToken = await this.authService.getAccessToken();
      if (!accessToken) {
        throw new Error('Failed to get access token');
      }
      await axios.get(`${this.reportServiceUrl}/api/v1/report/job-run/coc-report/${jobRunId}`, {headers:{Authorization:`Bearer ${accessToken}`}});
      this.logger.log(`[${jobRunId}] Triggering generateCOCReport successful`);
      return { message: 'Triggering generateCOCReport successful for job id: ' + jobRunId };
    } catch (error) {
      this.logger.error(`[${jobRunId}] Failed to Trigger generateCOCReport: ${error} | for url : ${this.reportServiceUrl}/api/v1/report/job-run/coc-report/${jobRunId}`);
      return { message: 'Error while Triggering generateCOCReport for the job id : ' + jobRunId };
    }
  }

  async updateCutOverStatus({jobRunId, status}: UpdateCutOverStatusInput): Promise<UpdateStatusOutput> {
    try {
      this.logger.log(`[${jobRunId}] Updating cutover status to URL ${this.workerJobServiceUrl}/api/v1/job-run`);
      this.logger.log(`[${jobRunId}] Updating  cutover status to ${status}`);
      const accessToken = await this.authService.getAccessToken();
      if (!accessToken) {
        throw new Error('Failed to get access token');
      }
      await axios.put(`${this.workerJobServiceUrl}/api/v1/job-run/cutover/${jobRunId}/${status}`, {}, {headers:{Authorization:`Bearer ${accessToken}`}});
      this.logger.log(`[${jobRunId}] status updated to ${status}`);
      return { message: 'Job status updated for job id: ' + jobRunId };
    } catch (error) {
      this.logger.error(`[${jobRunId}] Failed to update status: ${error}`);
      return { message: 'Error while updating the status of the job id : ' + jobRunId };
    }
  }  

}