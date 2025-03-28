import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Command, FileInfo, JobStatus, OPS_CMD, OPS_STATUS, Task, TaskStats, TaskStatus, TaskType } from '@netapp-cloud-datamigrate/jobs-lib';
import { JobState } from '@netapp-cloud-datamigrate/jobs-lib/dist/types/job-state';
import { uuid4 } from '@temporalio/workflow';
import axios from 'axios';
import { WorkersConfig } from 'src/config/app.config';
import { RedisService } from 'src/redis/redis.service';
import { buildTask, generateDummyFileEntry } from '../utils/utils';
import { CommonActivityService } from '../common/common.service';
import { KeycloakConfig } from 'src/config/keycloak.config';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { getAccessToken } from '../common/token.util';

@Injectable()
export class DiscoveryActivity {
  readonly workerId: string;
  readonly reportServiceUrl: string;
    private accessToken: string | null = null;
  private expiresAt: number = 0; 
  readonly keycloakConfig: KeycloakConfig;
  readonly tokenRequest: string
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(HttpService) private readonly httpService: HttpService,
    private readonly logger: Logger,
    private readonly redisService: RedisService,
    private readonly commonService: CommonActivityService
    
  ) {
    this.workerId = this.configService.get('worker.workerId');
    this.reportServiceUrl = this.configService.get('worker.workerReportServiceUrl');
    this.keycloakConfig = this.configService.get<KeycloakConfig>('keycloak');
    const tokenData = new URLSearchParams();
    tokenData.append('client_id', this.workerId);
    tokenData.append('client_secret', this.keycloakConfig.workerSecret);
    tokenData.append('grant_type', 'client_credentials');
    this.tokenRequest = tokenData.toString();
  }

  async getAccessToken(): Promise<string | null> {
          const now = Math.floor(Date.now() / 1000); 
          if (this.accessToken && now < this.expiresAt) 
              return this.accessToken;
          try {
              const response = await lastValueFrom(
                  this.httpService.post(
                      `${this.keycloakConfig.baseUrl}/realms/${this.keycloakConfig.realm}/protocol/openid-connect/token`,
                      this.tokenRequest,
                      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
                  )
              );

              this.accessToken = response.data.access_token;
              this.expiresAt = now + response.data.expires_in - 10; 
              this.logger.log(`Fetched new access token, expires at: ${this.expiresAt}`);
              return this.accessToken;
          } catch (error) {
              this.logger.error(`Failed to obtain access token: ${error.message}`);
              return null;
          }
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
      const jobState = await this.commonService.getJobState(traceId);
      const directoryBatchSize = 500;
      let commandsBatch: Command[] = [];
      for await (const directory of jobContext.groupReadDirs(`${traceId}-worker`, directoryBatchSize)) {
        const ops = { 0: { cmd: OPS_CMD.COPY_DIR, status: OPS_STATUS.READY } };
        const command = new Command(directory.path, ops, `${uuid4()}`,0);
        commandsBatch.push(command);
        this.logger.log(`[${traceId}] Task created for publishing.`)
        if (commandsBatch && commandsBatch.length >= directoryBatchSize) {
          const task = buildTask(TaskType.SCAN, traceId, jobContext, commandsBatch);
          const id = await jobContext.appendToTaskList(task);
          jobContext.tasksInfo.lastId = id;
          const newJobState = {
            ...jobState,
            tasks_total: jobState.tasks_total + 1,
            status: jobState.status,
          }
          jobContext.jobState = new JobState(newJobState.workers, newJobState.tasks_completed, newJobState.tasks_total, newJobState.workers_agreed, newJobState.status, []);
          await this.redisService.setJobContext(traceId, jobContext);
          this.logger.log(`[${traceId}] Task published.`);
          commandsBatch = [];
        }
      }
      if (commandsBatch.length > 0) {
        this.logger.log(`[${traceId}] Publishing tasks.`);
        const task = buildTask(TaskType.SCAN, traceId, jobContext, commandsBatch);
        const id = await jobContext.appendToTaskList(task);
        this.logger.log(`[${traceId}] Task published.`)
        jobContext.tasksInfo.lastId = id;
        const newJobState = {
          ...jobState,
          tasks_total: jobState.tasks_total + 1,
        }
        jobContext.jobState = new JobState(newJobState.workers, newJobState.tasks_completed, newJobState.tasks_total, newJobState.workers_agreed, newJobState.status, []);
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
      const accessToken = await this.getAccessToken();
      const workerJobServiceUrl = WorkersConfig.get('workerJobServiceUrl');
      this.logger.log(`[${traceId}] Updating discovery status to ${status}`);
      if (!accessToken) throw new Error('Access token is null');
      await axios.patch(`${workerJobServiceUrl}/${traceId}/${status}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });  
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



  async generateDiscoveryReport(jobRunId: string) {
    try {
      this.logger.log(`[${jobRunId}] reportServiceUrl to URL ${this.reportServiceUrl}/api/v1/report`);
      this.logger.log(`[${jobRunId}] Trigger generateDiscoveryReport `);
      const payload = { jobRunId: jobRunId, "report-type": "DISCOVER" };
      const accessToken = await getAccessToken(
        this.httpService,
        this.configService,
      );
      if (!accessToken) {
        throw new Error('Failed to get access token');
      }
      await axios.post(
        `${this.reportServiceUrl}/api/v1/report/inventory/generate-report`,
        payload,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      this.logger.log(`[${jobRunId}] Trigger generateDiscoveryReport Successful`);
      return { message: 'Trigger generateDiscoveryReport Successful for job id: ' + jobRunId };
    } catch (error) {
      this.logger.error(`[${jobRunId}] Failed to Trigger generateDiscoveryReport: ${error}`);
      return { message: 'Error while Trigger generateDiscoveryReport the status of the job id : ' + jobRunId };
    }
  }

}
// const generateDummyFileEntry: FileInfo = new FileInfo("LAST_FILE", "", "", false, 1001, 1001, 2048, true, new Date(), new Date(), new Date(), "", "", "", 0);

