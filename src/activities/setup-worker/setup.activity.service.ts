import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileServerDetails } from '@netapp-cloud-datamigrate/jobs-lib';
import axios from 'axios';
import * as fs from 'fs';
import { Protocol } from 'src/protocols/protocol/protocol';
import { ProtocolTypes, Protocols } from 'src/protocols/protocols';
import { RedisService } from 'src/redis/redis.service';
import * as util from 'util';

@Injectable()
export class SetupActivityService {
  readonly workerId: string;
  readonly workerConfigUrl: string;
  readonly baseWorkingPath: string
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly logger: Logger,
  ) {
    this.workerId = this.configService.get('worker.workerId');
    this.workerConfigUrl = this.configService.get('worker.workerConfigUrl');
    this.baseWorkingPath = this.configService.get('worker.baseWorkingPath')
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
      path: server.path,
      mountBasePath: this.baseWorkingPath,
      pathId: server.pathId,
      jobRunId,
    });
    console.log(
      `[${jobRunId}] - Worker ${this.workerId} cleanup completed for ${server.hostname}/${server.path}`,
    );
  }

  async setup(jobRunId: string): Promise<SetupOutput> {
    console.log(`[${jobRunId}] - [${this.workerId}] Setting up worker`);
    try {
      const context = await this.redisService.getJobContext(jobRunId);
      if (!context) {
        throw new Error(`Context not found for traceId ${jobRunId}`);
      }

      const protocolType = context.jobConfig.sourceFileServer.protocols[0].type;
      const protocol = Protocols.getProtocol(ProtocolTypes[protocolType]);
      // mount source path
      console.log(
        `[${jobRunId}] - [${this.workerId}] Setting up worke12iey12iuy12iur`,
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

      await axios.post(
        `${this.workerConfigUrl}/api/v1/work-manager/update/configs`,
        { jobRunId, workerIds: [this.workerId] },
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return {
        jobRunId,
        status: 'success',
        protocolType,
        workerId: this.workerId,
        message: `Worker ${this.workerId} successfully set up.`,
      };
    } catch (error) {
      console.error(`[${jobRunId}] - Setup failed: ${error.message}`);
      return {
        jobRunId,
        status: 'error',
        workerId: this.workerId,
        message: `Setup failed: ${error.message}`,
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

      return {
        jobRunId,
        status: 'success',
        protocolType,
        workerId: this.workerId,
        message: `Cleanup successful.`,
      };
    } catch (error) {
      console.error(`[${jobRunId}] - Cleanup failed: ${error.message}`);
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
    const { hostname, pathId, exportPathName, protocols } =
      payload;
    const mountPayload = {
      hostname,
      username: protocols?.userName,
      password: protocols?.password,
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
      );
      if (writePermission.status === 'failed') {
        // await protocol.unmountPath(traceId, mountPayload);
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
      // await protocol.unmountPath(traceId, mountPayload);
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

          // try {
          //   await protocol.unmountPath(traceId, mountPayload);
          // } catch (umountErr) {
          //   this.logger.error(
          //     `[${traceId}] - Unmount failed: ${umountErr.message}`,
          //   );
          // }

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
}
