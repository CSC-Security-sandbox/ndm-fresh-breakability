import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RedisService } from "src/redis/redis.service";
import { generateDummyFileEntry } from '../utils/utils';
import { UpdateStatusInput, UpdateStatusOutput } from "../migrate/migrate.type";
import axios from 'axios';
import { JobRunStatus } from "../discovery/enums";
import { JobState } from "@netapp-cloud-datamigrate/jobs-lib/dist/types/job-state";
import { JobContext, JobStatus, Task } from "@netapp-cloud-datamigrate/jobs-lib";

@Injectable()
export class CommonActivityService{
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

  async updateStatus({jobRunId, status}: UpdateStatusInput): Promise<UpdateStatusOutput> {
    try {
      this.logger.log(`[${jobRunId}] Updating status to URL ${this.workerJobServiceUrl}/api/v1/job-run`);
      this.logger.log(`[${jobRunId}] Updating status to ${status}`);
      await axios.patch(`${this.workerJobServiceUrl}/api/v1/job-run/${jobRunId}/${status}`);
      this.logger.log(`[${jobRunId}] status updated to ${status}`);
      return { message: 'Job status updated for job id: ' + jobRunId };
    } catch (error) {
      this.logger.error(`[${jobRunId}] Failed to update status: ${error}`);
      return { message: 'Error while updating the status of the job id : ' + jobRunId };
    }
  }

  async generateJobsReport(jobRunId: string) {
    try {
      this.logger.log(`[${jobRunId}] reportServiceUrl to URL ${this.reportServiceUrl}/api/v1/report`);
      this.logger.log(`[${jobRunId}] Triggering generateJobsReport for url : ${this.reportServiceUrl}/api/v1/report/inventory/generate-jobs-report`);
      await axios.post(`${this.reportServiceUrl}/api/v1/report/inventory/generate-jobs-report`, { jobRunId });
      this.logger.log(`[${jobRunId}] Triggering generateJobsReport successful`);
      return { message: 'Triggering generateJobsReport successful for job id: ' + jobRunId };
    } catch (error) {
      this.logger.error(`[${jobRunId}] Failed to Trigger generateJobsReport: ${error} | for url : ${this.reportServiceUrl}/api/v1/report/inventory/generate-jobs-report`);
      return { message: 'Error while Triggering generateJobsReport for the job id : ' + jobRunId };
    }
  }

  async updateJobErrorStatus(jobRunId: string) {
    await this.updateStatus({jobRunId, status: JobRunStatus.Errored});
    await this.updateLastEntry(jobRunId);
  }

  async getJobState(traceId: string): Promise<any> {
    const jobContext = await this.redisService.getJobContext(traceId);
    return await jobContext.getJobState();
  }

  async setJobState(traceId: string, jobState: JobState): Promise<any> {
    const jobContext = await this.redisService.getJobContext(traceId);
    jobContext.jobState = new JobState(
      jobState.workers ?? [], 
      jobState.tasks_completed, 
      jobState.tasks_total, 
      jobState.workers_agreed ?? [], 
      jobState.status as JobStatus,
      jobState.failedWorkers ?? []
    );;
    await this.redisService.setJobContext(traceId, jobContext);
  }

  async fetchOneTask(jobContext: JobContext): Promise<Task | undefined> {
    try {
      const tasks = await jobContext.groupReadTasks('consumer-1', 1);
      for await (const task of tasks) {
        if(task) {
          this.logger.debug(`Task: ${JSON.stringify(task)}`);
          return task;
        }
      }
      return undefined;
    } catch (error) {
      this.logger.error(`[${jobContext.jobRunId}] Failed to fetch the task: ${error}`);
      return undefined;
    }
  }
}