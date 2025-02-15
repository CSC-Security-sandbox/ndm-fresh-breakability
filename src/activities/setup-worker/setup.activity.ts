import { Inject, Injectable, Logger } from '@nestjs/common';
import { WorkersConfig } from 'src/config/app.config';
import { RedisUtils, JobContextFactory } from '@netapp-cloud-datamigrate/jobs-lib';
import axios from 'axios';
import { Protocol } from 'src/protocols/protocol/protocol';
import { ProtocolTypes, Protocols } from 'src/protocols/protocols';
import { ConfigService } from '@nestjs/config';
import { RedisService } from 'src/redis/redis.service';

@Injectable()
export class SetupActivityService {

  readonly workerId: string;
  readonly workerConfigUrl: string
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    private readonly logger: Logger,
    private readonly redisService: RedisService,
  ) {
    this.workerId = this.configService.get('worker.workerId');
    this.workerConfigUrl = WorkersConfig.get('worker.workerConfigUrl');
  }

  async setup(jobRunId: string): Promise<any> {

    let redisClient = null;
    this.logger.log(`[${jobRunId}] - [${this.workerId}] Setting up worker`);

    try {
        const context = await this.redisService.getJobContext(jobRunId);
        if (!context) {
            throw new Error(`Context not found for traceId ${jobRunId}`);
        }

        const protocolType = context.jobConfig.sourceFileServer.protocols[0].type;
        const protocol = Protocols.getProtocol(ProtocolTypes[protocolType]);
        const { hostname, pathId, path, workingDirectory } = context.jobConfig.sourceFileServer;
        const payload = { hostname, username: 'root', password: '', path, workingDirectory, pathId, jobRunId };
        await protocol.mountPath(jobRunId, payload);

        this.logger.log(`[${jobRunId}] - Worker ${this.workerId} set up for ${hostname}/${path}`);

        await axios.post(`${this.workerConfigUrl}/update/configs`, { jobRunId, workerIds: [this.workerId] });
        return { jobRunId, status: 'success', protocolType, hostname, workerId:this.workerId, message: `Worker ${this.workerId} successfully set up.` };
    } catch (error) {
      this.logger.error(`[${jobRunId}] - Setup failed: ${error.message}`);
      return { jobRunId, status: 'error', workerId: this.workerId, message: `Setup failed: ${error.message}` };
    } finally {
      if (redisClient?.isOpen) {
        await redisClient.quit();
        this.logger.log(`[${jobRunId}] - Redis client connection closed.`);
      }
    }
  }

    async cleanup(jobRunId: string): Promise<any> {
        try {
            const context = await this.redisService.getJobContext(jobRunId);

            if (!context) {
                throw new Error(`Context not found for traceId ${jobRunId}`);
            }

            const protocolType = context.jobConfig.sourceFileServer.protocols[0].type;
            const protocol = Protocols.getProtocol(ProtocolTypes[protocolType]);
            const { hostname, pathId, path, workingDirectory } = context.jobConfig.sourceFileServer;
            const payload = { hostname, username: 'root', password: '', path, workingDirectory, pathId, jobRunId };
            await protocol.unmountPath(jobRunId, payload);

            this.logger.log(`[${jobRunId}] - Worker ${this.workerId} cleanup completed for ${hostname}/${path}`);
            return { jobRunId, status: 'success', protocolType, hostname, workerId: this.workerId, message: `Cleanup successful.` };
        } 
        catch (error) {
            this.logger.error(`[${jobRunId}] - Cleanup failed: ${error.message}`);
            return { jobRunId, status: 'error', workerId: this.workerId, message: `Cleanup failed: ${error.message}` };
        }
    }
}
