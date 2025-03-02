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
    try {
      const workerConfigServiceUrl = WorkersConfig.get('workerConfigUrl');
      const apiUrl = `${workerConfigServiceUrl}/validate/working-directory`;
      const accessToken = "ACCESS_TOKEN"; // TODO handle access token logic

      let configStatusPayload: ConfigStatusPayload = {
        configId: payload.configId,
        status: null,
        errorMessage: null
      }

      if (payload.exportPathPresent) {
        this.logger.log("Provided Export Path Present");
        this.logger.log("Started validating working directory");

        const isValidDirectory = await this.isValidDirectory(payload, traceId);

        if (isValidDirectory) {
          this.logger.log("Valid working directory");
          configStatusPayload.status = ConfigStatus.ACTIVE;
        } else {
          this.logger.log("InValid working directory");
          configStatusPayload.status = ConfigStatus.ERRORED;
          configStatusPayload.errorMessage = ConfigError.INVALID_WORKING_DIRECTORY;
        }
      } else {
        this.logger.log("Invalid Export Path");
        configStatusPayload.status = ConfigStatus.ERRORED;
        configStatusPayload.errorMessage = ConfigError.INVALID_EXPORT_PATH;
      }

      await this.updateConfigStatus(apiUrl, accessToken, configStatusPayload);

      return {
        traceId: traceId,
        status: 'success',
        workerId: this.workerId,
        message: `Provided export path and working directory for workerId ${this.workerId} validated successfully`,
      };;
    } catch (error) {
      return {
        traceId: traceId,
        status: 'error',
        workerId: this.workerId,
        message: `Error while validating export path & working directory : ${error}`,
      };
    }
  }

  async updateConfigStatus(apiUrl: string, accessToken: string, payload: any) {
    try {
      await axios.post(apiUrl, payload, {
        headers: {
          // "Authorization": `Bearer ${accessToken}`, //TODO
          "Content-Type": "application/json"
        }
      });
    } catch (error) {
      console.error("Error calling API:", error?.response?.data || error.message);
      throw error;
    }
  }

  async isValidDirectory(payload: any, traceId: string) {
    try {
      for (let fileServer of payload.listPathPayload) {
        const protocolType = fileServer.type;
        const protocol = Protocols.getProtocol(ProtocolTypes[protocolType]);
        const mountPathPayload = {
          hostname: fileServer.host,
          username: fileServer.username,
          password: fileServer.password,
          path: payload.exportPath,
          workingDirectory: WorkersConfig.get('baseDirectoryToValidateWorkingDirectory'),
          pathId: traceId,
          jobRunId: traceId
        }

        this.logger.log("Mounting export path started");
        await protocol.mountPath(traceId, mountPathPayload);
        this.logger.log("Mounted export path successfully");

        this.logger.log("started validating the working directory");
        const mountPoint = `/etc/${traceId}/${traceId}`;
        const fullPath = path.join(mountPoint, payload.workingDirectory);

        if (fs.existsSync(fullPath)) {
          this.logger.log(`The provided working directory ${fullPath} exists.`);
          return true;
        } else {
          this.logger.log(`The provided working directory ${fullPath} does not exist.`);
        }

        const unmountPathPayload = {
          hostname: fileServer.host,
          username: fileServer.username,
          password: fileServer.password,
          path: payload.exportPath,
          workingDirectory: WorkersConfig.get('baseDirectoryToValidateWorkingDirectory'),
          pathId: traceId,
          jobRunId: traceId
        }

        this.logger.log("UnMounting export path started");
        await protocol.unmountPath(traceId, unmountPathPayload);
        this.logger.log("UnMounted export path successfully");
      }
      return false;
    } catch (error) {
      this.logger.log(`Error while validating given working directory - ${error.message}`);
    }
  }

}
