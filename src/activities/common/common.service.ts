import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RedisService } from "src/redis/redis.service";
import { generateDummyErrorEntry, generateDummyFileEntry, generateDummyTaskEntry } from '../utils/utils';
import { UpdateStatusInput, UpdateStatusOutput } from "../migrate/migrate.type";
import axios from 'axios';
import { JobRunStatus } from "../discovery/enums";
import { JobState } from "@netapp-cloud-datamigrate/jobs-lib/dist/types/job-state";
import { GroupReaderType, JobContext, JobStatus, Task } from "@netapp-cloud-datamigrate/jobs-lib";
import { HttpService } from "@nestjs/axios";
import { AuthService } from "src/auth/auth.service";

@Injectable()
export class CommonActivityService{
  readonly workerId: string;
  readonly fetchTaskBatch: number;
  readonly pushTaskDirSize: number;
  readonly workerJobServiceUrl: string;
  readonly reportServiceUrl: string;
  readonly migrationTaskLimit: number;
  
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly authService: AuthService,
    private readonly logger: Logger,
    private readonly redisService: RedisService,
  ) {
    this.workerId = this.configService.get('worker.workerId');
    this.workerJobServiceUrl = this.configService.get('worker.workerJobServiceUrl');
    this.reportServiceUrl = this.configService.get('worker.workerReportServiceUrl');
    this.migrationTaskLimit = this.configService.get('worker.migrationTaskLimit');
    this.fetchTaskBatch = 50, this.pushTaskDirSize = 500;
  }

  async updateLastEntry(traceId: string): Promise<any> {
    try {
      this.logger.log(`[${traceId}] Publishing last entry for job id: ${traceId}`);
      const jobContext = await this.redisService.getJobContext(traceId);
      const id = await jobContext.appendToFileList(generateDummyFileEntry);
      jobContext.filesInfo.lastId = id;
      
      const directoryId  = await jobContext.appendToDirList(generateDummyFileEntry);
      jobContext.dirsInfo.lastId = directoryId;

      const lastTask = await jobContext.appendToTaskList(generateDummyTaskEntry);
      jobContext.tasksInfo.lastId = lastTask;

      const migratedTask = await jobContext.appendToMigrationTask(generateDummyTaskEntry);
      jobContext.migrateTask.lastId = migratedTask;

      const updateTask = await jobContext.appendToUpdatedTaskList(generateDummyTaskEntry);
      jobContext.updatedTaskInfo.lastId = updateTask;

      const errorTask = await jobContext.appendToErrorList(generateDummyErrorEntry);
      jobContext.errorsInfo.lastId = errorTask;
      
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
      const accessToken = await this.authService.getAccessToken();
      if (!accessToken) {
        throw new Error('Failed to get access token');
      }
      await axios.patch(`${this.workerJobServiceUrl}/api/v1/job-run/${jobRunId}/${status}`, {}, {headers:{Authorization : `Bearer ${accessToken}`}});
      
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
      
      const accessToken = await this.authService.getAccessToken();
      if (!accessToken) {
        throw new Error('Failed to get access token');
      }
      await axios.post(
        `${this.reportServiceUrl}/api/v1/report/inventory/generate-jobs-report`,
        { jobRunId },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
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
      jobState.failedWorkers ?? [],
      jobState.isScanCompleted ?? false,
    );
    await this.redisService.setJobContext(traceId, jobContext);
  }

  async getJobStateWithStreamLoad(traceId: string, jobType: 'SCAN' | 'SYNC'): Promise<{jobState: JobState, isStreamOverloaded: boolean}> {
    const jobContext = await this.redisService.getJobContext(traceId);
    const jobState = await jobContext.getJobState();
    const isStreamOverloaded = await jobContext.getMigrationTaskLength() > this.migrationTaskLimit;
    await this.publishPendingTasksToStream(jobContext, jobType);
    return { jobState, isStreamOverloaded };
  }

  async fetchOneTask(jobContext: JobContext): Promise<Task | undefined> {
    try {
      const tasks = await jobContext.groupReadTasks(this.workerId, 1, GroupReaderType.WORKER);
      let returnTask = undefined;
      for await (const task of tasks) {
        if(task) {
          returnTask = task;
        }
      }
      return returnTask;
    } catch (error) {
      this.logger.error(`[${jobContext.jobRunId}] Failed to fetch the task: ${error}`);
      return undefined;
    }
  }

  async fetchOneMigrationTask(jobContext: JobContext): Promise<Task | undefined> {
    try {
      const tasks = await jobContext.groupReadMigrationTask(this.workerId, 1, GroupReaderType.WORKER);
      let returnTask = undefined;
      for await (const task of tasks) {
        if(task) {
          returnTask = task;
        }
      }
      return returnTask;
    } catch (error) {
      this.logger.error(`[${jobContext.jobRunId}] Failed to fetch the task: ${error}`);
      return undefined;
    }
  }

  async getJobStateAndUpdateTaskList(traceId: string, jobType: 'SCAN' | 'SYNC'): Promise<any> {
    const jobContext = await this.redisService.getJobContext(traceId);
    await this.publishPendingTasksToStream(jobContext, jobType);
    return await jobContext.getJobState();
  }

  async publishPendingTasksToStream(jobContext: JobContext, jobType: 'SCAN' | 'SYNC'): Promise<any> {
    if(jobType === 'SCAN') {
      const runningScanTasks = await jobContext.getAllRunningScanTasks();
      if(!!runningScanTasks && runningScanTasks.length > 0) {
        for (const task of runningScanTasks) if(!task) await jobContext.appendToTaskList(task);
        await jobContext.deleteAllScanTasks();
      }
    }
    if(jobType === 'SYNC') {
      const runningSyncTasks = await jobContext.getAllRunningSyncTasks();
      if(!!runningSyncTasks && runningSyncTasks.length > 0) {
        for (const task of runningSyncTasks) if(!task) await jobContext.appendToMigrationTask(task);
        await jobContext.deleteAllSyncTasks();
      }
    }
  }

  async updateWorkerResponse(jobRunId: string, workerId: string, workerResponse: Record<string, any>) {
    try {
      this.logger.log(`[${jobRunId}] Updating worker response to URL ${this.workerJobServiceUrl}/api/v1/job-run/worker-response/${jobRunId}/${workerId}`);
      const accessToken = await this.authService.getAccessToken();
      if (!accessToken) throw new Error('Failed to get access token');
      await axios.put(`${this.workerJobServiceUrl}/api/v1/job-run/worker-response/${jobRunId}/${workerId}`, workerResponse, { headers: { Authorization: `Bearer ${accessToken}` } });
      this.logger.log(`[${jobRunId}] Worker response updated successfully`);
      return { message: 'Worker response updated successfully for job id: ' + jobRunId };
    } catch (error) {
      this.logger.error(`[${jobRunId}] Failed to update worker response: ${error}`);
      return { message: 'Error while updating the worker response for the job id : ' + jobRunId };
    }
  }
}