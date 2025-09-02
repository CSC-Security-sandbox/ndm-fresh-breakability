import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from 'axios';
import { AuthService } from "src/auth/auth.service";
import { RedisService } from "src/redis/redis.service";
import { JobRunStatus, UpdateCutOverStatusInput, UpdateStatusInput, UpdateStatusOutput } from "./enums";
import {
  LoggerFactory,
  LoggerService
} from '@netapp-cloud-datamigrate/logger-lib';
import { generateDummyErrorEntry, generateDummyItemEntry, generateDummyTaskInfoEntry } from '../utils/utils';
import { JobType } from "@netapp-cloud-datamigrate/jobs-lib";
import { SmbUserSetupService } from "../core/migrate/command-execution/smb-user-setup.service";

@Injectable()
export class CommonActivityService{
  readonly workerId: string;
  readonly fetchTaskBatch: number;
  readonly pushTaskDirSize: number;
  readonly workerJobServiceUrl: string;
  readonly reportServiceUrl: string;
  readonly migrationTaskLimit: number;
  readonly maxRetryCount: number;
  private readonly logger : LoggerService;
  
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    private readonly authService: AuthService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly redisService: RedisService,
    private readonly smbUserSetup: SmbUserSetupService,
  ) {
    this.workerId = this.configService.get('worker.workerId');
    this.maxRetryCount = this.configService.get('worker.maxRetryCount') || 3;
    this.workerJobServiceUrl = this.configService.get('worker.connection.workerJobServiceUrl');
    this.reportServiceUrl = this.configService.get('worker.connection.workerReportServiceUrl');
    this.migrationTaskLimit = this.configService.get('worker.migrationTaskStreamLimit');
    this.fetchTaskBatch = 50, this.pushTaskDirSize = 500;
    this.logger = loggerFactory.create(CommonActivityService.name);
  }

  async cleanupJobContext(traceId: string): Promise<any> {
    try{
      const jobContext = await this.redisService.getJobManagerContext(traceId);
      await jobContext.cleanup();
    }catch(error){
      this.logger.error(`[${traceId}] Error while cleaning up the job context: ${error}`);
      throw new Error(`Error while cleaning up the job context: ${traceId}`);
    }
  }

  async updateLastEntry(traceId: string): Promise<any> {
    try {
      this.logger.log(`[${traceId}] Publishing last entry for job id: ${traceId}`);
      const jobContext = await this.redisService.getJobManagerContext(traceId);
      await jobContext.publishToFileStream(generateDummyItemEntry);
      await jobContext.publishToTaskStream(generateDummyTaskInfoEntry);
      await jobContext.publishToErrorStream(generateDummyErrorEntry);
      this.logger.log(`[${traceId}] Last entry published for job id: ${traceId}`);
      return { message: 'Job completed for job id: ' + traceId };
    } catch (error) {
      this.logger.error(`[${traceId}] Error while marking the job as completed : ${error}`);
      throw new Error(`Error while marking the job as completed : ${traceId}`);
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
      throw new Error(`Error while updating the status of the job id : ${jobRunId}`);
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
      throw new Error(`Error while Triggering generateJobsReport for the job id : ${jobRunId}`);
    }
  }
  
  async updateJobErrorStatus(jobRunId: string) {
    await this.updateStatus({jobRunId, status: JobRunStatus.Errored});
    await this.updateLastEntry(jobRunId);
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
      throw new Error(`Error while updating the worker response for the job id : ${jobRunId}`);
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
      throw new Error(`Error while Trigger generateDiscoveryReport the status of the job id : ${jobRunId}`);
    }
  }

  async generateCOCReport(jobRunId: string) {
    try {
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
      throw new Error(`Error while Triggering generateCOCReport for the job id : ${jobRunId}`);
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
      throw new Error(`Error while updating the status of the job id : ${jobRunId}`);
    }
  } 
}