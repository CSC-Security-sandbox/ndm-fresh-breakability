import * as fs from 'fs';
import * as path from 'path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from "axios";
import { WorkersConfig } from 'src/config/app.config';
import { ConfigError, ConfigStatus, ConfigStatusPayload } from './working-directory.type';
import { ProtocolTypes, Protocols } from 'src/protocols/protocols';

@Injectable()
export class ValidateWorkingDirectoryActivity {
  readonly workerId: string;
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    private readonly logger: Logger,
  ) {
    this.workerId = this.configService.get('worker.workerId');
  }

  async validateWorkingDirectory(traceId: string, payload: any): Promise<any> {
    const workerConfigUrl = WorkersConfig.get('workerConfigUrl');
    const apiUrl = `${workerConfigUrl}/api/v1/work-manager/validate/working-directory`;
    const accessToken = "ACCESS_TOKEN"; // TODO: Handle access token logic

    const configStatusPayload: ConfigStatusPayload = {
      configId: payload.configId,
      status: null,
      errorMessage: null
    };

    if (!payload.exportPathPresent) {
      this.logger.log("Invalid Export Path");
      configStatusPayload.status = ConfigStatus.ERRORED;
      configStatusPayload.errorMessage = ConfigError.INVALID_EXPORT_PATH;
    } else {
      this.logger.log("Valid Export Path");
      this.logger.log("Started validating working directory");

      try {
        const isValid = await this.isValidDirectory(payload, traceId);
        configStatusPayload.status = isValid ? ConfigStatus.ACTIVE : ConfigStatus.ERRORED;
        configStatusPayload.errorMessage = isValid ? null : ConfigError.INVALID_WORKING_DIRECTORY;
      } catch (error) {
      const errorMessage = error?.message.includes('RPC prog. not avail') ? `The server does not support to provided NFS version. Please use a valid version.` : error?.message;

        this.logger.error(`Working directory validation error: ${error?.message}`);
        configStatusPayload.status = ConfigStatus.ERRORED;
        configStatusPayload.errorMessage = errorMessage;
      }
    }

    await this.updateConfigStatus(apiUrl, accessToken, configStatusPayload);

    return {
      traceId,
      status: configStatusPayload.status === ConfigStatus.ACTIVE ? 'success' : 'error',
      workerId: this.workerId,
      message: configStatusPayload.errorMessage
        ? `Validation failed: ${configStatusPayload.errorMessage}`
        : `Export path and Working directory validated successfully for workerId ${this.workerId}`,
    };
  }

  async updateConfigStatus(apiUrl: string, accessToken: string, payload: ConfigStatusPayload) {
    try {
      await axios.post(apiUrl, payload, {
        headers: {
          // "Authorization": `Bearer ${accessToken}`, // TODO: Implement token handling
          "Content-Type": "application/json"
        }
      });
    } catch (error) {
      this.logger.error(`API Error: ${error?.response?.data || error.message}`);
      throw new Error(`API Error: ${error?.response?.data || error.message}`);
    }
  }

  async isValidDirectory(payload: any, traceId: string): Promise<boolean> {
    const baseMountDir = WorkersConfig.get('baseWorkingPath');
    let isDirectoryValid = false;
    let hasWritePermission = false;

    try {
      for (const fileServer of payload.listPathPayload) {
        const protocol = Protocols.getProtocol(ProtocolTypes[fileServer.type]);

        const mountPathPayload = {
          hostname: fileServer.host,
          username: fileServer.username,
          password: fileServer.password,
          protocolVersion: fileServer.protocolVersion,
          path: payload.exportPath,
          mountBasePath: baseMountDir,
          pathId: traceId,
          jobRunId: traceId
        };

        this.logger.log(`Mounting export path for host ${fileServer.host}`);
        await protocol.mountPath(traceId, mountPathPayload);
        this.logger.log("Mounted export path successfully");

        this.logger.log("Started validating the working directory");
        const mountPoint = path.join(baseMountDir, traceId, traceId);
        const fullPath = path.join(mountPoint, payload.workingDirectory);

        if (fs.existsSync(fullPath)) {
          this.logger.log(`Working Directory exists: ${fullPath}`);
          isDirectoryValid = true;

          try {
            fs.accessSync(fullPath, fs.constants.W_OK);
            this.logger.log(`Write permission is available for: ${fullPath}`);
            hasWritePermission = true;
          } catch (err) {
            this.logger.error(`No write permission for: ${fullPath}`);
            hasWritePermission = false;
          }
        } else {
          this.logger.log(`Working Directory does not exist: ${fullPath}`);
        }

        this.logger.log(`Unmounting export path for host ${fileServer.host}`);
        await protocol.unmountPath(traceId, mountPathPayload);
        this.logger.log("Unmounted export path successfully");

        if (isDirectoryValid && !hasWritePermission) {
          throw new Error(`Provided working directory ${payload?.workingDirectory} has no writable permission`);
        }

        if (isDirectoryValid && hasWritePermission) break;
      }
    } catch (error) {
      this.logger.error(`Working Directory validation error: ${error?.message}`);
      throw new Error(error.message);
    }

    return isDirectoryValid && hasWritePermission;
  }

}
