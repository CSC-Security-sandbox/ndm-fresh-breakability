import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileServerDetails, JobStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import { JobState } from '@netapp-cloud-datamigrate/jobs-lib/dist/types/job-state';
import axios from 'axios';
import * as fs from 'fs';
import { lastValueFrom } from 'rxjs';
import { KeycloakConfig } from 'src/config/keycloak.config';
import { Protocol } from 'src/protocols/protocol/protocol';
import { Protocol as pc } from '@netapp-cloud-datamigrate/jobs-lib';
import { ProtocolTypes, Protocols } from 'src/protocols/protocols';
import { RedisService } from 'src/redis/redis.service';
import * as util from 'util';

import { WorkersConfig } from 'src/config/app.config';
import { SetupWorkerParams } from '../types/tasks';
@Injectable()
export class SetupActivityService {
  private accessToken: string | null = null;
  private expiresAt: number = 0;
  readonly keycloakConfig: KeycloakConfig;
  readonly tokenRequest: string;
  readonly workerId: string;
  readonly workerConfigUrl: string;
  readonly baseWorkingPath: string;
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(HttpService) private readonly httpService: HttpService,
    private readonly redisService: RedisService,
    private readonly logger: Logger,
  ) {
    this.workerId = this.configService.get('worker.workerId');
    this.workerConfigUrl = this.configService.get('worker.workerConfigUrl');
    this.baseWorkingPath = this.configService.get('worker.baseWorkingPath');
    this.keycloakConfig = this.configService.get<KeycloakConfig>('keycloak');
    const tokenData = new URLSearchParams();
    tokenData.append('client_id', this.workerId);
    tokenData.append('client_secret', this.keycloakConfig.workerSecret);
    tokenData.append('grant_type', 'client_credentials');
    this.tokenRequest = tokenData.toString();
  }

  async getAccessToken(): Promise<string | null> {
    console.log('this got called getAccessToken');
    const now = Math.floor(Date.now() / 1000);
    if (this.accessToken && now < this.expiresAt) return this.accessToken;
    try {
      const response = await lastValueFrom(
        this.httpService.post(
          `${this.keycloakConfig.baseUrl}/realms/${this.keycloakConfig.realm}/protocol/openid-connect/token`,
          this.tokenRequest,
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
        ),
      );

      this.accessToken = response.data.access_token;
      this.expiresAt = now + response.data.expires_in - 10;
      this.logger.log(
        `Fetched new access token, expires at: ${this.expiresAt}`,
      );
      return this.accessToken;
    } catch (error) {
      this.logger.error(`Failed to obtain access token: ${error.message}`);
      return null;
    }
  }
  
  async mountPath(
    server: FileServerDetails,
    protocol: Protocol,
    jobRunId: string,
  ) {
    await protocol.mountPath(jobRunId, {
      hostname: server.hostname,
      username: server.username,
      password: server.password,
      protocolVersion: server.protocolVersion,
      path: server.path,
      mountBasePath: this.baseWorkingPath,
      pathId: server.pathId,
      jobRunId,
    });
    console.log(
      `[${jobRunId}] - Worker ${this.workerId} set up for ${server.hostname}/${server.path}`,
    );
  }

  async unmountPath(
    server: FileServerDetails,
    protocol: Protocol,
    jobRunId: string,
  ) {
    await protocol.unmountPath(jobRunId, {
      hostname: server.hostname,
      username: server.username,
      password: server.password,
      protocolVersion: server.protocolVersion,
      path: server.path,
      mountBasePath: this.baseWorkingPath,
      pathId: server.pathId,
      jobRunId,
    });
    console.log(
      `[${jobRunId}] - Worker ${this.workerId} cleanup completed for ${server.hostname}/${server.path}`,
    );
  }
  async  waitFor(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
  async speedTestSetup(args: SetupWorkerParams): Promise<any> {
    this.logger.log(`[${args.jobRunId}] - [${this.workerId}] Setting up worker`);

    try {
      // Retrieve the protocol based on the protocol type
      const protocol = Protocols.getProtocol(ProtocolTypes[args.protocolType]);
      this.logger.debug(`[${args.jobRunId}] - [${this.workerId}] Protocol resolved: ${args.protocolType}`);

      // Get the base working directory from the configuration
      const workingDirectory = WorkersConfig.get('baseWorkingPath');

      // Create FileServerDetails object with the provided arguments
      const fsDetails = new FileServerDetails(
        args.hostname,
        args.protocols,
        args.pathId,
        args.path,
        args.userName,
        args.password,
        workingDirectory
      );

      // Mount the file system path
      this.logger.debug(`[${args.jobRunId}] - [${this.workerId}] Mounting path`);
      await this.mountPath(fsDetails, protocol, args.jobRunId);

      // Update worker configuration via an API call
      this.logger.debug(`[${args.jobRunId}] - [${this.workerId}] Updating worker configuration`);
      await axios.post(
        `${this.workerConfigUrl}/api/v1/work-manager/update/configs`,
        { jobRunId: args.jobRunId, workerIds: [this.workerId] }
      );

      // Wait for 1 second to ensure the configuration is updated
      await this.waitFor(1000);

      // Return success response
      this.logger.log(`[${args.jobRunId}] - [${this.workerId}] Worker setup completed successfully`);
      return {
        jobRunId: args.jobRunId,
        status: 'success',
        protocolType: args.protocolType,
        workerId: this.workerId,
        message: `Worker ${this.workerId} successfully set up.`,
        fsDetails,
        fileServerId: args.fileServerId,
        volumeId: args.volumeId,
        tests: args.tests,
      };
    } catch (error) {
      // Log the error and return a failure response
      this.logger.error(`[${args.jobRunId}] - Setup failed: ${error.message}`);
      return {
        jobRunId: args.jobRunId,
        status: 'error',
        workerId: this.workerId,
        message: `Setup failed: ${error.message}`,
      };
    }
  }

  async setup(jobRunId: string): Promise<SetupOutput> {
    this.logger.log(`[${jobRunId}] - [${this.workerId}] Setting up worker`);
    try {
      const context = await this.redisService.getJobContext(jobRunId);
      if (!context) {
        throw new Error(`Context not found for traceId ${jobRunId}`);
      }

      const protocolType = context.jobConfig.sourceFileServer.protocols[0].type;
      const protocol = Protocols.getProtocol(ProtocolTypes[protocolType]);
      // mount source path
      this.logger.log(
        `[${jobRunId}] - [${this.workerId}] Setting up worker`,
      );
      await this.mountPath(
        context.jobConfig.sourceFileServer,
        protocol,
        jobRunId,
      );

      // mount destination path if exists
      if (context.jobConfig?.destinationFileServer)
        await this.mountPath(
          context.jobConfig.destinationFileServer,
          protocol,
          jobRunId,
        );
       
      const accessToken = await this.getAccessToken();
      if(!accessToken) {
        throw new Error('Failed to get access token');
      }
      await axios.post(
        `${this.workerConfigUrl}/api/v1/work-manager/update/configs`,
        { jobRunId, workerIds: [this.workerId] },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      await this.waitFor(1000);
      return {
        jobRunId,
        status: 'success',
        protocolType,
        workerId: this.workerId,
        message: `Worker ${this.workerId} successfully set up.`,
      };
    } catch (error) {
      this.logger.error(`[${jobRunId}] - Setup failed: ${error?.message ?? error}`);
      return {
        jobRunId,
        status: 'error',
        workerId: this.workerId,
        message: `Setup failed: ${error.message}`,
      };
    }
  }

  async speedTestCleanup(jobRunId: string, fsDetails:FileServerDetails, protocolType:string): Promise<any> {
    try {

      const protocol = Protocols.getProtocol(ProtocolTypes[protocolType]);
      // unmount source path
      await this.unmountPath(
        fsDetails,
        protocol,
        jobRunId,
      );
      await this.waitFor(1000);


      return {
        jobRunId,
        status: 'success',
        protocolType,
        workerId: this.workerId,
        message: `Cleanup successful.`,
      };
    } catch (error) {
      this.logger.error(`[${jobRunId}] - Cleanup failed: ${error.message}`);
      return {
        jobRunId,
        status: 'error',
        workerId: this.workerId,
        message: `Cleanup failed: ${error.message}`,
      };
    }
  }

  async cleanup(jobRunId: string): Promise<SetupOutput> {
    try {
      const context = await this.redisService.getJobContext(jobRunId);

      if (!context) {
        throw new Error(`Context not found for traceId ${jobRunId}`);
      }

      const protocolType = context.jobConfig.sourceFileServer.protocols[0].type;
      const protocol = Protocols.getProtocol(ProtocolTypes[protocolType]);
      // unmount source path
      await this.unmountPath(
        context.jobConfig.sourceFileServer,
        protocol,
        jobRunId,
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // unmount destination path if exists
      try {
        if (context.jobConfig?.destinationFileServer)
          await this.unmountPath(
            context.jobConfig.destinationFileServer,
            protocol,
            jobRunId,
          );
      } catch (error) {
        console.error(`[${jobRunId}] - Cleanup failed: ${error?.message}`);
        return {
          jobRunId,
          status: 'error',
          workerId: this.workerId,
          message: `Cleanup failed: ${error?.message}`,
        };
      }

      const jobState: JobState = await this.redisService.getJobState(jobRunId);
      //TODO :: Need to looking in feature for job Paused
      if(jobState.status !== JobStatus.Paused) {
        this.logger.log(`[${jobRunId}] - Cleaning up job context`);
        // await context.cleanup();
        this.logger.log(`[${jobRunId}] - Job context cleaned up`);
      }
      return {
        jobRunId,
        status: 'success',
        protocolType,
        workerId: this.workerId,
        message: `Cleanup successful.`,
      };
    } catch (error) {
      this.logger.error(`[${jobRunId}] - Cleanup failed: ${error.message}`);
      return {
        jobRunId,
        status: 'error',
        workerId: this.workerId,
        message: `Cleanup failed: ${error.message}`,
      };
    }
  }

  async mountAndCheckWritePermission(
    payload: any,
    traceId: string,
    checkWritePermission: boolean = false,
  ): Promise<any> {
    const protocolType = payload.protocols.type;
    const protocol = Protocols.getProtocol(ProtocolTypes[protocolType]);
    const mountBasePath = this.baseWorkingPath;
    const { hostname, pathId, exportPathName, protocols, protocolVersion } =
      payload;
    const mountPayload = {
      hostname,
      username: protocols?.userName,
      password: protocols?.password,
      protocolVersion,
      path: exportPathName,
      mountBasePath: mountBasePath,
      pathId,
      jobRunId: traceId,
    };
    this.logger.log(
      `[${traceId}] - Mounting path  ${exportPathName} for ${hostname} ---- ${JSON.stringify(mountPayload)}`,
    );
    const result = await protocol.mountPath(traceId, mountPayload);
    if (result.status === 'error') {
      if (payload.type == 'DESTINATION') {
        return {
          destinationId: pathId,
          status: 'failed',
          errors: ['DESTINATION_PATH_MOUNT_FAILED'],
        };
      } else {
        return {
          sourceId: pathId,
          status: 'failed',
          errors: ['SOURCE_PATH_MOUNT_FAILED'],
        };
      }
    }
    const delay = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    this.logger.log(
      `[${traceId}] - Mounting path successful`,
      JSON.stringify(result),
    );
    this.logger.log('Checking write permission');
    this.logger.log(
      `[${traceId}] - Checking write permission for ${exportPathName}`,
    );
    if (checkWritePermission) {
      const writePermission = await this.checkWritePermission(
        payload.exportPathName,
        payload.pathId,
        traceId,
        mountBasePath,
        hostname,
        protocols?.userName,
        protocols?.password,
        protocol,
        payload.type,
        protocolVersion,
      );
      if (writePermission.status === 'failed') {
        await protocol.unmountPath(traceId, mountPayload);
        delay(5000);
        if (payload.type == 'DESTINATION') {
          return {
            destinationId: pathId,
            status: 'failed',
            errors: ['DESTINATION_PATH_WRITE_PERMISSION_FAILED'],
          };
        } else {
          return {
            sourceId: pathId,
            status: 'failed',
            errors: ['SOURCE_PATH_WRITE_PERMISSION_FAILED'],
          };
        }
      }
      this.logger.log(
        `[${traceId}] -Write permission`,
        JSON.stringify(writePermission),
      );
      this.logger.log(
        `[${traceId}] - Mounting path successful`,
        JSON.stringify(result),
      );
      return { status: 'success' };
    } else {
      await protocol.unmountPath(traceId, mountPayload);
      delay(5000);
      if (payload.type == 'DESTINATION') {
        return {
          destinationId: pathId,
          status: 'success',
        };
      } else {
        return {
          sourceId: pathId,
          status: 'success',
        };
      }
    }
  }
  checkWritePermission(
    exportPathName: string,
    pathId: string,
    traceId: string,
    mountBasePath: string,
    hostname: string,
    userName: string,
    password: string,
    protocol: Protocol,
    type: string,
    protocolVersion: string,
  ): Promise<any> {
    this.logger.log(
      `[${traceId}] - Checking write permission for ${exportPathName}`,
    );
    const delay = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    return new Promise(async (resolve, reject) => {
      const mountPayload = {
        hostname,
        username: userName,
        password: password,
        path: exportPathName,
        mountBasePath: mountBasePath,
        pathId,
        jobRunId: traceId,
        protocolVersion,
      };

      const testFile = `${mountBasePath}/${traceId}/${pathId}/test-${traceId}.txt`;
      this.logger.log(
        `[${traceId}] - Checking write permission for ${testFile}`,
      );
      const closeAsync = util.promisify(fs.close);
      const unlinkAsync = util.promisify(fs.unlink);
      fs.open(testFile, 'w', async (err, fd) => {
        try {
          if (err) {
            this.logger.error(
              `[${traceId}] - Write permission check failed: ${err.message}`,
            );
            resolve({
              traceId,
              status: 'failed',
              message: `Write permission check failed: ${err.message}`,
            });
            return;
          }
          this.logger.log(`[${traceId}] - Write permission check successful`);

          try {
            await protocol.unmountPath(traceId, mountPayload);
          } catch (umountErr) {
            this.logger.error(
              `[${traceId}] - Unmount failed: ${umountErr.message}`,
            );
          }

          resolve({
            traceId,
            status: 'success',
            message: `Write permission check successful`,
          });
        } catch (error) {
          this.logger.error(
            `[${traceId}] - Unexpected error: ${error.message}`,
          );
          resolve({
            traceId,
            status: 'failed',
            message: `Unexpected error: ${error.message}`,
          });
        } finally {
          if (fd) {
            try {
              await closeAsync(fd);
            } catch (closeErr) {
              this.logger.error(
                `[${traceId}] - Error closing file descriptor: ${closeErr.message}`,
              );
            }
          }
        }
        try {
          await unlinkAsync(testFile);
          this.logger.log(`[${traceId}] - Test file deleted successfully.`);
        } catch (error) {
          this.logger.error(
            `[${traceId}] - Error deleting test file: ${error}`,
          );
        }
      });
    });
  }
  async disconnectActiveSession(payload: any): Promise<any> {
    try {
      this.logger.log(
        payload.traceId,
        `[DisconnectActiveSession] Disconnecting active session for ${payload.fileServer.hostname}`,
      );
      const protocol: Protocol = Protocols.getProtocol(
        ProtocolTypes[payload.fileServer.protocolType],
      );
      // const response = await protocol.disconnectSession(payload.traceId, payload);
      // this.logger.log(
      //   payload.traceId,
      //   `[DisconnectActiveSession] Session disconnected for ${payload.fileServer.hostname}`,
      // );
      return { response: 'success' };
    } catch (error) {
      this.logger.log(
        payload.traceId,
        `[DisconnectActiveSession] Error disconnecting session for ${payload.fileServer.hostname}: ${error}`,
      );
      return {
        traceId: payload.traceId,
        status: 'error',
        workerId: payload.workerId,
        message: `Error disconnecting session for ${payload.fileServer.hostname}: ${error}`,
      };
    }
  }
  async cleanUpMountPath(payload: any): Promise<any> {
    try {
      this.logger.log(
        payload.traceId,
        `[cleanUp] Cleaning up for ${payload.fileServer.hostname}`,
      );
      const protocol: Protocol = Protocols.getProtocol(
        ProtocolTypes[payload.fileServer.protocolType],
      );
      const response = await protocol.unmountPath(payload.traceId, payload);
      this.logger.log(
        payload.traceId,
        `[cleanUp] Cleaned up for ${payload.fileServer.hostname}`,
      );
      return response;
    } catch (error) {
      this.logger.log(
        payload.traceId,
        `[cleanUp] Error cleaning up for ${payload.fileServer.hostname}: ${error}`,
      );
      return {
        traceId: payload.traceId,
        status: 'error',
        workerId: payload.workerId,
        message: `Error cleaning up for ${payload.fileServer.hostname}: ${error}`,
      };
    }
  }
}
