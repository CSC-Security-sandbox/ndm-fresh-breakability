import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RedisService } from "src/redis/redis.service";
import { generateDummyFileEntry } from '../utils/utils';
import { UpdateStatusInput, UpdateStatusOutput } from "../migrate/migrate.type";
import axios from 'axios';

@Injectable()
export class CommonService{
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
}