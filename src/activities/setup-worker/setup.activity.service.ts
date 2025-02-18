import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileServerDetails } from '@netapp-cloud-datamigrate/jobs-lib';
import axios from 'axios';
import { Protocol } from 'src/protocols/protocol/protocol';
import { ProtocolTypes, Protocols } from 'src/protocols/protocols';
import { RedisService } from 'src/redis/redis.service';

@Injectable()
export class SetupActivityService {

  readonly workerId: string;
  readonly workerConfigUrl: string
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {
    this.workerId = this.configService.get('worker.workerId');
    this.workerConfigUrl = this.configService.get('worker.workerConfigUrl');
  }

  async mountPath(server: FileServerDetails, protocol: Protocol, jobRunId: string) {
    await protocol.mountPath(jobRunId,  { 
        hostname: server.hostname,
        username :  server.username, 
        password: server.password, 
        path: server.path, 
        workingDirectory: server.password, 
        pathId: server.pathId, 
        jobRunId 
    });
    console.log(`[${jobRunId}] - Worker ${this.workerId} set up for ${server.hostname}/${server.path}`);
  }

  async unmountPath(server: FileServerDetails, protocol: Protocol, jobRunId: string) {
    await protocol.unmountPath(jobRunId,  { 
        hostname: server.hostname,
        username :  server.username, 
        password: server.password, 
        path: server.path, 
        workingDirectory: server.password, 
        pathId: server.pathId, 
        jobRunId 
    });
    console.log(`[${jobRunId}] - Worker ${this.workerId} cleanup completed for ${server.hostname}/${server.path}`);
  }

  async setup(jobRunId: string): Promise<any> {
    console.log(`[${jobRunId}] - [${this.workerId}] Setting up worker`);
    try {
        const context = await this.redisService.getJobContext(jobRunId);
        console.log(`[${jobRunId}] - [${this.workerId}] Setting up worke12iey12iuy12iur`);
        console.log(context)
        if (!context) {
            throw new Error(`Context not found for traceId ${jobRunId}`);
        }

        const protocolType = context.jobConfig.sourceFileServer.protocols[0].type;
        const protocol = Protocols.getProtocol(ProtocolTypes[protocolType]);
        // mount source path
        console.log(`[${jobRunId}] - [${this.workerId}] Setting up worke12iey12iuy12iur`);
        await this.mountPath(context.jobConfig.sourceFileServer, protocol, jobRunId);

        // mount destination path if exists
        if(context.jobConfig?.destinationFileServer) 
            await this.mountPath(context.jobConfig.destinationFileServer, protocol, jobRunId);

        // await axios.post(`${this.workerConfigUrl}/update/configs`, { jobRunId, workerIds: [this.workerId] });
        return { jobRunId, status: 'success', protocolType, workerId:this.workerId, message: `Worker ${this.workerId} successfully set up.` };
    } catch (error) {
        console.error(`[${jobRunId}] - Setup failed: ${error.message}`);
        return { jobRunId, status: 'error', workerId: this.workerId, message: `Setup failed: ${error.message}` };
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
        // unmount source path
        await this.unmountPath(context.jobConfig.sourceFileServer, protocol, jobRunId);

        // unmount destination path if exists
        if(context.jobConfig?.destinationFileServer) 
            await this.unmountPath(context.jobConfig.destinationFileServer, protocol, jobRunId);

        return { jobRunId, status: 'success', protocolType, workerId: this.workerId, message: `Cleanup successful.` };
      } 
      catch (error) {
          console.error(`[${jobRunId}] - Cleanup failed: ${error.message}`);
          return { jobRunId, status: 'error', workerId: this.workerId, message: `Cleanup failed: ${error.message}` };
      }
    }
}
