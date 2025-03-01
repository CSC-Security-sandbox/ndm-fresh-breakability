import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Command, FileInfo, JobStatus, Task } from '@netapp-cloud-datamigrate/jobs-lib';
import { JobState } from '@netapp-cloud-datamigrate/jobs-lib/dist/types/job-state';
import { uuid4 } from '@temporalio/workflow';
import axios from 'axios';
import { WorkersConfig } from 'src/config/app.config';
import { RedisService } from 'src/redis/redis.service';

@Injectable()
export class DiscoveryActivity {
  readonly workerId: string;
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    private readonly logger: Logger,
    private readonly redisService: RedisService,
  ) {
    this.workerId = this.configService.get('worker.workerId');
  }
  
  async getWorkerId(): Promise<string> {
    return await this.workerId;
  }

  async fetchTasks(traceId: string): Promise<any> {
    try {
      const batchSize = 10;
      const jobContext = await this.redisService.getJobContext(traceId);
      const tasks = await jobContext.groupReadTasks('consumer-1', batchSize);
      const streamMessages = [];
      for await (const task of tasks) streamMessages.push(task);
      this.logger.log(`[${traceId}] Fetched ${streamMessages.length} tasks.`);
      return streamMessages;
    } catch (error) {
      this.logger.error(`[${traceId}] Failed to fetch the task: ${error}`);
      return [];
    }
  }

  async publishTask(traceId: string): Promise<any> {
    this.logger.log(`[${traceId}] Starting publishTask`);
    try {
      const jobContext = await this.redisService.getJobContext(traceId);
      this.logger.log(`[${traceId}] JobContext retrieved. Processing files.`);
      const jobState = await this.getJobState(traceId);
      const directoryBatchSize = 500;
      let commandsBatch: Command[] = [];
      for await (const directory of jobContext.groupReadDirs(
        'consumer-1',
        directoryBatchSize,
      )) {
        const ops = { 0: { cmd: 'SCAN', status: 'PENDING' } };
        const command = new Command(directory.path, ops, `${uuid4()}`);
        commandsBatch.push(command);
        this.logger.log(`[${traceId}] Task created for publishing.`)
        if (commandsBatch && commandsBatch.length >= directoryBatchSize) {
          const task = new Task(
            uuid4(),
            traceId,
            'SCAN',
            'PENDING',
            jobContext.jobConfig.workerIds[0],
            jobContext.jobConfig.sourceFileServer.path,
            jobContext.jobConfig.sourceFileServer.pathId,
            commandsBatch,
            jobContext.jobConfig?.destinationFileServer?.pathId ?? null,
            jobContext.jobConfig?.destinationFileServer?.pathId ?? null
          );
          const id = await jobContext.appendToTaskList(task);
          jobContext.tasksInfo.lastId = id;
          const newJobState = {
            ...jobState,
            tasks_total: jobState.tasks_total + 1,
            status: jobState.status,
          }
          jobContext.jobState = new JobState(newJobState.workers, newJobState.tasks_completed, newJobState.tasks_total, newJobState.workers_agreed, newJobState.status);
          await this.redisService.setJobContext(traceId, jobContext);
          this.logger.log(`[${traceId}] Task published.`);
          commandsBatch = [];
        }
      }
      if (commandsBatch.length > 0) {
        this.logger.log(`[${traceId}] Publishing tasks.`);
        const task = new Task(
          uuid4(),
          traceId,
          'SCAN',
          'PENDING',
          jobContext.jobConfig.workerIds[0],
          jobContext.jobConfig.sourceFileServer.path,
          jobContext.jobConfig.sourceFileServer.pathId,
          commandsBatch,
          jobContext.jobConfig?.destinationFileServer?.path ?? null,
          jobContext.jobConfig?.destinationFileServer?.pathId ?? null
        );
        const id = await jobContext.appendToTaskList(task);
        this.logger.log(`[${traceId}] Task published.`)
        jobContext.tasksInfo.lastId = id;
        const newJobState = {
          ...jobState,
          tasks_total: jobState.tasks_total + 1,
        }
        jobContext.jobState = new JobState(newJobState.workers, newJobState.tasks_completed, newJobState.tasks_total, newJobState.workers_agreed, newJobState.status);
        await this.redisService.setJobContext(traceId, jobContext);
        this.logger.log(`[${traceId}] Task published successfully.`)
      }
      return { status: 'success', message: 'Task published successfully' };
    } catch (error) {
      this.logger.error(`[${traceId}] Error in publishing task: ${error.message}`);
      return {
        traceId: traceId,
        status: 'error',
        message: `Failed to publish task for Job run id ${traceId} : ${error}`,
      };
    }
  }

  async discoveryStatusUpdate(traceId: string, status: string): Promise<any> {
    try {
      const workerJobServiceUrl = WorkersConfig.get('workerJobServiceUrl');
      this.logger.log(`[${traceId}] Updating discovery status to ${status}`);
      await axios.patch(`${workerJobServiceUrl}/api/v1/job-run/${traceId}/${status}`);
      this.logger.log(`[${traceId}] Discovery status updated to ${status}`);
      return { message: 'Discovery Job status updated as completed for job id: ' + traceId };
    } catch (error) {
      this.logger.error(`[${traceId}] Failed to update discovery status: ${error}`);
      return { message: 'Error while updating the satus of the job id : ' + traceId };
    }
  }

  async publishLastEntry(traceId: string): Promise<any> {
    try {
      this.logger.log(`[${traceId}] Publishing last entry for job id: ${traceId}`);
      const jobContext = await this.redisService.getJobContext(traceId);
      const id = await jobContext.appendToFileList(generateDummyFileEntry);
      jobContext.errorsInfo.lastId = id;
      this.redisService.setJobContext(traceId, jobContext);
      this.logger.log(`[${traceId}] Last entry published for job id: ${traceId}`);
      return { message: 'Discovery Job completed for job id: ' + traceId };
    } catch (error) {
      this.logger.error(`[${traceId}] Error while marking the job as completed : ${error}`);
      return { message: 'Error while marking the job as completed : ' + traceId };
    }
  }

  async getJobState(traceId: string): Promise<any> {
    const jobContext = await this.redisService.getJobContext(traceId);
    return await jobContext.getJobState();
  }

  async setJobState(traceId: string, jobState: JobState): Promise<any> {
    const jobContext = await this.redisService.getJobContext(traceId);
    const newjobState = new JobState(
      jobState.workers, 
      jobState.tasks_completed, 
      jobState.tasks_total, 
      jobState.workers_agreed, 
      jobState.status as JobStatus
    );
    jobContext.jobState = newjobState;
    await this.redisService.setJobContext(traceId, jobContext);
  }

}
const generateDummyFileEntry: FileInfo = new FileInfo("LAST_FILE", "", "", false, 1001, 1001, 2048, true, new Date(), new Date(), new Date(), "", "", "", 0);

