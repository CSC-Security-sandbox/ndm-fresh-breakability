import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Command, GroupReaderType, OPS_CMD, OPS_STATUS, Task, TaskType } from '@netapp-cloud-datamigrate/jobs-lib';
import { uuid4 } from '@temporalio/workflow';
import axios from 'axios';
import { AuthService } from 'src/auth/auth.service';
import { WorkersConfig } from 'src/config/app.config';
import { RedisService } from 'src/redis/redis.service';
import { buildTask, generateDummyFileEntry } from '../utils/utils';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class DiscoveryActivity {
  readonly workerId: string;
  readonly reportServiceUrl: string;
  readonly directoryBatchSize: number;
  readonly tokenRequest: string
  private readonly logger: LoggerService;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly redisService: RedisService,
  ) {
    this.workerId = this.configService.get('worker.workerId');
    this.reportServiceUrl = this.configService.get('worker.connection.workerReportServiceUrl');
    this.directoryBatchSize = this.configService.get('worker.maxScanCommand') || 500;
    this.logger = loggerFactory.create(DiscoveryActivity.name);
  }
  
  async getWorkerId(): Promise<string> {
    return await this.workerId;
  }

 
  async publishTask(traceId: string): Promise<any> {
    this.logger.log(`[${traceId}] Starting publishTask`);
    try {
      const jobContext = await this.redisService.getJobContext(traceId);
      this.logger.log(`[${traceId}] JobContext retrieved. Processing files.`);
      let commandsBatch: Command[] = [], streamIds: string[] = [], tasks: Task[] = [];
      const ops = { 0: { cmd: OPS_CMD.COPY_DIR, status: OPS_STATUS.READY } };
      for await (const { data, id } of jobContext.groupReadWithoutAckDirs(traceId, this.directoryBatchSize*5, GroupReaderType.WORKER)) {
        const command = new Command(data.path, ops, `${uuid4()}`,0);
        commandsBatch.push(command);
        streamIds.push(id);
        if (commandsBatch && commandsBatch.length >= this.directoryBatchSize) {
          const task = buildTask(TaskType.SCAN, traceId, jobContext, commandsBatch);
          tasks.push(task);
          commandsBatch = [];
        }
      }
      if (commandsBatch.length > 0) {
        const task = buildTask(TaskType.SCAN, traceId, jobContext, commandsBatch);
        tasks.push(task);
      }
      this.logger.log(`[${traceId}] Total commands to publish: ${streamIds.length}`);
      if(tasks.length > 0)
        await jobContext.ackDirAndCreateTask(GroupReaderType.WORKER, streamIds, tasks);
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
      const accessToken = await this.authService.getAccessToken();
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
      const accessToken = await this.authService.getAccessToken();
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


