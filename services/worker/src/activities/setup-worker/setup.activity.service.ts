import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileServerDetails, JobStatus, JobType } from '@netapp-cloud-datamigrate/jobs-lib';
import { JobState } from '@netapp-cloud-datamigrate/jobs-lib/dist/types/job-state';
import axios from 'axios';
import { KeycloakConfig } from 'src/config/keycloak.config';
import { Protocol } from 'src/protocols/protocol/protocol';
import { ProtocolTypes, Protocols } from 'src/protocols/protocols';
import { RedisService } from 'src/redis/redis.service';
import { AuthService } from 'src/auth/auth.service';
import { WorkersConfig } from 'src/config/app.config';
import { SetupWorkerParams } from '../types/tasks';
import { RetryableError } from 'src/errors/errors.types';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { SmbUserSetupService } from '../core/migrate/command-execution/smb-user-setup.service';

@Injectable()
export class SetupActivityService {
  private readonly logger: LoggerService;
  readonly keycloakConfig: KeycloakConfig;
  readonly tokenRequest: string;
  readonly workerId: string;
  readonly workerConfigUrl: string;
  readonly baseWorkingPath: string;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(AuthService) private readonly authService: AuthService,
    private readonly redisService: RedisService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly protocols: Protocols,
    private readonly smbUserSetup: SmbUserSetupService,
  ) {
    this.workerId = this.configService.get('worker.workerId');
    this.baseWorkingPath = this.configService.get('worker.baseWorkingPath');
    this.workerConfigUrl = this.configService.get('worker.connection.workerConfigUrl');
    this.logger = loggerFactory.create(SetupActivityService.name);
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
    }, true);
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
    }, true);
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
      const protocol = this.protocols.getProtocol(ProtocolTypes[args.protocolType]);
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
        { jobRunId: args.jobRunId, workerId: this.workerId }
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
      const context = await this.redisService.getJobManagerContext(jobRunId);
      if (!context) {
        throw new Error(`Context not found for traceId ${jobRunId}`);
      }
     

      const protocolType = context.jobConfig.sourceFileServer.protocols[0].type;
      const protocol = this.protocols.getProtocol(ProtocolTypes[protocolType]);
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
       
        // setup users for SMB 
        try {
          if (process.platform === 'win32' && context.jobConfig?.jobType != JobType.DISCOVERY) {
            await this.smbUserSetup.removePrincipals(context.jobConfig.destinationFileServer, context.jobConfig.destinationFileServer.username);
          }
        } catch (error) {
          this.logger.error(`[${jobRunId}] - SMB file owner setup failed: ${error.message}`);
        }
      const accessToken = await this.authService.getAccessToken();
      if(!accessToken) {
        throw new Error('Failed to get access token');
      }
      await axios.post(
        `${this.workerConfigUrl}/api/v1/work-manager/update/configs`,
        { jobRunId, workerId: this.workerId },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      
      await this.waitFor(1000);
      
      return {
        jobRunId,
        status: 'success',
        protocolType,
        workerId: this.workerId,
        message: `Worker ${this.workerId} successfully set up`,
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

      const protocol = this.protocols.getProtocol(ProtocolTypes[protocolType]);
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
      const context = await this.redisService.getJobManagerContext(jobRunId);

      if (!context) {
        throw new Error(`Context not found for traceId ${jobRunId}`);
      }

      const protocolType = context.jobConfig.sourceFileServer.protocols[0].type;
      const protocol = this.protocols.getProtocol(ProtocolTypes[protocolType]);
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
      throw new RetryableError(`Cleanup failed: ${error.message}`);
    }
  }
}
