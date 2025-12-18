import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from "axios";
import * as fs from 'fs';
import { unlinkSync, writeFileSync } from 'fs';
import * as path from 'path';
import { join } from 'path';
import { AuthService } from 'src/auth/auth.service';
import { ProtocolTypes, Protocols } from 'src/protocols/protocols';
import { ConfigError, ConfigStatus, ConfigStatusPayload } from './working-directory.type';
import { ExportPathSource } from '../list-path/list-path.type';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class ValidateWorkingDirectoryActivity {
  readonly workerId: string;
  readonly baseWorkingPath: string;
  readonly workerConfigUrl: string;
  readonly projectId: string;
  private readonly logger: LoggerService;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly authService: AuthService,
    private readonly protocols: Protocols
  ) {
    this.workerId = this.configService.get('worker.workerId');
    this.baseWorkingPath = this.configService.get('worker.baseWorkingPath');
    this.workerConfigUrl = this.configService.get('worker.connection.workerConfigUrl');
    this.projectId = this.configService.get('worker.projectId');
    this.logger = loggerFactory.create(ValidateWorkingDirectoryActivity.name);
  }

  async validateWorkingDirectory(traceId: string, payload: any): Promise<any> {
    const apiUrl = `${this.workerConfigUrl}/api/v1/work-manager/validate/working-directory`;

    const configStatusPayload: ConfigStatusPayload = {
      configId: payload.configId,
      status: null,
      errorMessage: null
    };

    const isDell = payload?.isDell || payload?.serverType === 'dell';
    const isPathExists = !!payload?.paths?.length;
    
    // For Dell Isilon, exports are already discovered via API (stored in VolumeEntity)
    // so paths may be empty but we still have dellExportsMap to validate
    const hasDellExports = isDell && payload?.dellExportsMap && Object.keys(payload.dellExportsMap).length > 0;
    
    if(!isPathExists && !payload.hasManualUpload && !hasDellExports) {
      configStatusPayload.status = ConfigStatus.ERRORED;
      configStatusPayload.errorMessage = ConfigError.UNABLE_TO_DETECT_EXPORT_PATH;
      await this.updateConfigStatus(apiUrl, configStatusPayload);
      return {
        traceId,
        status: 'error',
        workerId: this.workerId,
        message: ConfigError.UNABLE_TO_DETECT_EXPORT_PATH,
      };
    }

    if(!payload?.exportPathWorkingDirectoryProvided) {
      try {
        this.logger.log("Export Path not provided, fetching from file server");
        await this.handleMountAndUnmountPaths(traceId, payload);
        this.logger.log("Export Path fetched successfully");
        configStatusPayload.status = ConfigStatus.ACTIVE;
        configStatusPayload.errorMessage = null;
      } catch (error) {
        const errorMessage = this.getNfsMountErrorMessage(error);
        this.logger.error(`Error while mounting: ${errorMessage}`);
        configStatusPayload.status = ConfigStatus.ERRORED;
        configStatusPayload.errorMessage = errorMessage;
      }
    } else if (!payload.exportPathPresent) {
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
        const errorMessage = this.getNfsMountErrorMessage(error);
        this.logger.error(`Working directory validation error: ${errorMessage}`);
        configStatusPayload.status = ConfigStatus.ERRORED;
        configStatusPayload.errorMessage = errorMessage;
      }
    }

    await this.updateConfigStatus(apiUrl, configStatusPayload);

    return {
      traceId,
      status: configStatusPayload.status === ConfigStatus.ACTIVE ? 'success' : 'error',
      workerId: this.workerId,
      message: configStatusPayload.errorMessage
        ? `Validation failed: ${configStatusPayload.errorMessage}`
        : `Export path and Working directory validated successfully for workerId ${this.workerId}`,
    };
  }

  private getNfsMountErrorMessage(error: any): string {
    const errorMsg = error?.message || '';

    if (errorMsg.includes('illegal NFS version value')) {
      return ConfigError.PROTOCOL_NOT_SUPPORTED;
    } else if (errorMsg.includes('RPC prog. not avail')) {
      return ConfigError.PROTOCOL_NOT_SUPPORTED;
    } else if(errorMsg.includes('Protocol not supported for')) {
      return ConfigError.PROTOCOL_NOT_SUPPORTED;
    } else if(errorMsg.includes('version') && errorMsg.includes('mismatch')) {
      return ConfigError.PROTOCOL_NOT_SUPPORTED;
    } else if(errorMsg.includes('port') && (errorMsg.includes('blocked') || errorMsg.includes('filtered'))) {
      return ConfigError.PROTOCOL_PORT_BLOCKED;
    } else if(errorMsg.includes('os') && (errorMsg.includes('not supported') || errorMsg.includes('unsupported'))) {
      return ConfigError.HOST_OS_NOT_SUPPORTED;
    } else {
      return errorMsg;
    }
  }

  async handleMountAndUnmountPaths(traceId: string, payload: any): Promise<void> {
    const isDell = payload?.isDell || payload?.serverType === 'dell';
    
    try {
      for (const fileServer of payload.listPathPayload) {
        if(fileServer.exportPathSource === ExportPathSource.MANUAL_UPLOAD) {
          this.logger.log(`Skipping mounting and unmounting for MANUAL_UPLOAD type for host ${fileServer.host}`);
          continue;
        }
        
        const protocol = this.protocols.getProtocol(ProtocolTypes[fileServer.type]);

        // For Dell, get the export path from dellExportsMap for this specific host
        // This was discovered via Isilon API and stored in VolumeEntity
        let exportPath = payload.fetchedPath;
        if (isDell && payload.dellExportsMap && payload.dellExportsMap[fileServer.host]) {
          exportPath = payload.dellExportsMap[fileServer.host];
          this.logger.log(`Dell Isilon: Using discovered export path ${exportPath} for host ${fileServer.host}`);
        }

        const mountPathPayload = {
          hostname: fileServer.host,
          username: fileServer.username,
          password: fileServer.password,
          protocolVersion: fileServer.protocolVersion,
          path: exportPath,
          mountBasePath: this.baseWorkingPath,
          pathId: traceId,
          jobRunId: traceId,
        };

        this.logger.log(`Mounting export path for host ${fileServer.host}`);
        await protocol.mountPath(traceId, mountPathPayload, false);
        this.logger.log("Mounted export path successfully");

        this.logger.log(`Unmounting export path for host ${fileServer.host}`);
        await protocol.unmountPath(traceId, mountPathPayload, false);
        this.logger.log("Unmounted export path successfully");
      }
    } catch (error) {
      this.logger.error(`Error while mounting the path - ${error?.message || error}`);
      throw new Error(error?.message || error);
    }
  }

  async updateConfigStatus(apiUrl: string, payload: ConfigStatusPayload) {
    try {
      const accessToken = await this.authService.getAccessToken();
      await axios.post(apiUrl, payload, {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`,
          "projectId": this.projectId
        }
      });
    } catch (error) {
      this.logger.error(`API Error: ${error?.response?.data || error.message}`);
      throw new Error(`API Error: ${error?.response?.data || error.message}`);
    }
  }

  async isValidDirectory(payload: any, traceId: string): Promise<boolean> {
    let isDirectoryValid = false;
    let hasWritePermission = false;

    try {
      for (const fileServer of payload.listPathPayload) {
        const protocol = this.protocols.getProtocol(ProtocolTypes[fileServer.type]);

        const mountPathPayload = {
          hostname: fileServer.host,
          username: fileServer.username,
          password: fileServer.password,
          protocolVersion: fileServer.protocolVersion,
          path: payload.exportPath,
          mountBasePath: this.baseWorkingPath,
          pathId: traceId,
          jobRunId: traceId
        };

        this.logger.log(`Mounting export path for host ${fileServer.host}`);
        await protocol.mountPath(traceId, mountPathPayload, false);
        this.logger.log("Mounted export path successfully");

        this.logger.log("Started validating the working directory");
        const mountPoint = path.join(this.baseWorkingPath, traceId, traceId);
        const fullPath = path.join(mountPoint, payload.workingDirectory);

        if (fs.existsSync(fullPath)) {
          this.logger.log(`Working Directory exists: ${fullPath}`);
          isDirectoryValid = true;

          hasWritePermission = this.checkWritable(fullPath);

        } else {
          this.logger.log(`Working Directory does not exist: ${fullPath}`);
        }

        this.logger.log(`Unmounting export path for host ${fileServer.host}`);
        await protocol.unmountPath(traceId, mountPathPayload, false);
        this.logger.log("Unmounted export path successfully");

        if (isDirectoryValid && !hasWritePermission) {
          throw new Error(`Provided working directory ${payload?.workingDirectory} has no writable permission`);
        }

        if (isDirectoryValid && hasWritePermission) break;
      }
    } catch (error) {
      this.logger.error(`Working Directory validation error: ${error?.message || error}`);
      throw new Error(error?.message || error);
    }

    return isDirectoryValid && hasWritePermission;
  }
 
  checkWritable(directoryPath: string): boolean {
    const testFile = join(directoryPath, '.nfs_write_test');
    try {
      writeFileSync(testFile, '');
      unlinkSync(testFile);
      this.logger.log(`Success: Directory ${directoryPath} is writable.`);
      return true;
    } catch (error) {
      this.logger.error(`Error: No write permission for directory ${directoryPath} - ${error.message}`);
      return false;
    }
  }

}
