import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileServerDetails } from '@netapp-cloud-datamigrate/jobs-lib';
import axios from 'axios';
import * as fs from 'fs';
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
    private readonly logger: Logger,
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
        workingDirectory: server.workingDirectory, 
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
        workingDirectory: server.workingDirectory, 
        pathId: server.pathId, 
        jobRunId 
    });
    console.log(`[${jobRunId}] - Worker ${this.workerId} cleanup completed for ${server.hostname}/${server.path}`);
  }

  async setup(jobRunId: string): Promise<any> {
    console.log(`[${jobRunId}] - [${this.workerId}] Setting up worker`);
    try {
        const context = await this.redisService.getJobContext(jobRunId);
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

        await axios.post(`${this.workerConfigUrl}/update/configs`, { jobRunId, workerIds: [this.workerId] });
        await new Promise((resolve) => setTimeout( resolve, 1000));
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
        await new Promise((resolve) => setTimeout( resolve, 1000));

        // unmount destination path if exists
        try{
          if(context.jobConfig?.destinationFileServer) 
              await this.unmountPath(context.jobConfig.destinationFileServer, protocol, jobRunId);
        } catch(error) {
          console.error(`[${jobRunId}] - Cleanup failed: ${error?.message}`);
          return { jobRunId, status: 'error', workerId: this.workerId, message: `Cleanup failed: ${error?.message}` };
        }

        return { jobRunId, status: 'success', protocolType, workerId: this.workerId, message: `Cleanup successful.` };
      } 
      catch (error) {
          console.error(`[${jobRunId}] - Cleanup failed: ${error.message}`);
          return { jobRunId, status: 'error', workerId: this.workerId, message: `Cleanup failed: ${error.message}` };
      }
    }

    async mountAndCheckWritePermission(
      payload: any,
      traceId: string,
      checkWritePermission: boolean = false,
    ): Promise<any> {
       this.logger.log(`[${traceId}] - Mounting path for ${JSON.stringify(payload)}`);
      const protocolType = payload.protocols.type;
      const protocol = Protocols.getProtocol(ProtocolTypes[protocolType]);
      const { hostname, pathId, exportPathName, mountBasePath,protocols} = payload;
      const mountPayload = {
        hostname,
        username: protocols?.userName,
        password:protocols?.password,
        path:exportPathName,
        workingDirectory:mountBasePath,
        pathId,
        jobRunId:traceId,
      };
       this.logger.log(`[${traceId}] - Mounting path &&&&& ${exportPathName} for ${hostname} ---- ${JSON.stringify(mountPayload)}`);
      const result = await protocol.mountPath(traceId, mountPayload);
      if (result.status === 'error') {
       if(payload.type=='DESTINATION'){
        return {
          destinationId: pathId,
          status: 'failed',
          errors: ['DESTINATION_PATH_MOUNT_FAILED'],
        }
       }else{
        return {
          sourceId: pathId,
          status: 'failed',
          errors: ['SOURCE_PATH_MOUNT_FAILED'],
        }
       }
      }
      //need to check with salim on this one
      // const umountResult = await protocol.unmountPath(traceId, mountPayload);
      if (checkWritePermission) {
        const writePermission = await this.checkWritePermission(
          payload.workingDirectory,
          payload.workingDirectoryExportPathName,
          payload.workingDirectoryPathId,
          traceId,
          payload.mountBasePath,
          hostname,
          protocols?.userName,
          protocols?.password,
          protocol,
          payload.type
        );
        if (writePermission.status === 'failed') {
          if(payload.type=='DESTINATION'){
            return {
              destinationId: pathId,
              status: 'failed',
              errors: ['DESTINATION_PATH_WRITE_PERMISSION_FAILED'],
            }
           }else{
            return {
              sourceId: pathId,
              status: 'failed',
              errors: ['SOURCE_PATH_WRITE_PERMISSION_FAILED'],
            }
        }
      }
       this.logger.log(`[${traceId}] -Write permission`, JSON.stringify(writePermission));
       this.logger.log(`[${traceId}] - Mounting path successful`, JSON.stringify(result));
      return {status: 'success'};
    }
  }
    checkWritePermission(workingDirectory:string,
      workingDirectoryExportPathName:string,pathId:string,traceId:string,
      mountBasePath:string,
      hostname:string,
      userName:string,
      password:string,
      protocol:Protocol,
      type:string): Promise<any> {
       this.logger.log(`[${traceId}] - Checking write permission for ${workingDirectory}`);
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      return new Promise(async (resolve, reject) => {
        const mountPayload = {
          hostname,
          username: userName,
          password:password,
          path:workingDirectoryExportPathName,
          workingDirectory:mountBasePath,
          pathId,
          jobRunId:traceId,
        }
        const mountResult= await protocol.mountPath(traceId, mountPayload);
        if(mountResult.status === 'error'){
          if(type=='DESTINATION'){
            return {
              destinationId: pathId,
              status: 'failed',
              errors: ['DESTINATION_WORKING_DIR_PATH_MOUNT_FAILED'],
            }
           }else{
            return {
              sourceId: pathId,
              status: 'failed',
              errors: ['SOURCE_WORKING_DIR_PATH_MOUNT_FAILED'],
            }
           }
        }
  
        const testFile = `${mountBasePath}/${traceId}/${pathId}${workingDirectory}/test-${traceId}.txt`;
         this.logger.log(`[${traceId}] - Checking write permission for ${testFile}`);
        fs.open(testFile, 'w',async (err) => {
          if (err) {
             this.logger.error(`[${traceId}] - Write permission check failed: ${err.message}`);
            resolve({
              traceId,
              status: 'failed',
              message: `Write permission check failed: ${err.message}`,
            });
          } else {
            //TO Do: Needs to check permission issue to delete the file after writing
                 this.logger.log(`[${traceId}] - Write permission check successful`);
                //need to check with salim on umount 
                // const umountResult = await protocol.unmountPath(traceId, mountPayload);
                resolve({
                  traceId,
                  status: 'success',
                  message: `Write permission check successful`,
                });
              }
            });
           
          });
        }
}
