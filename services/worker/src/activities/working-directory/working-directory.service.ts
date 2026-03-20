import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from "axios";
import * as fs from 'fs';
import * as path from 'path';
import { join } from 'path';
import { promises as fsPromises } from 'fs';
import { promisify } from 'util';
import { exec } from 'child_process';
import { AuthService } from 'src/auth/auth.service';
import { ProtocolTypes, Protocols } from 'src/protocols/protocols';
import { ConfigError, ConfigStatus, ConfigStatusPayload } from './working-directory.type';
import { ExportPathSource } from '../list-path/list-path.type';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { ClientConfig, StorageClientFactory } from 'src/storage-clients/storage-client.factory';

const execAsync = promisify(exec);

@Injectable()
export class ValidateWorkingDirectoryActivity {
  readonly workerId: string;
  readonly baseWorkingPath: string;
  readonly workerConfigUrl: string;
  readonly projectId: string;
  private readonly logger: LoggerService;
  private readonly storageClientFactory: StorageClientFactory;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly authService: AuthService,
    private readonly protocols: Protocols,
    storageClientFactory: StorageClientFactory
  ) {
    this.workerId = this.configService.get('worker.workerId');
    this.baseWorkingPath = this.configService.get('worker.baseWorkingPath');
    this.workerConfigUrl = this.configService.get('worker.connection.workerConfigUrl');
    this.projectId = this.configService.get('worker.projectId');
    this.logger = loggerFactory.create(ValidateWorkingDirectoryActivity.name);
    this.storageClientFactory = storageClientFactory;
  }

  async validateWorkingDirectory(traceId: string, payload: any): Promise<any> {
    const apiUrl = `${this.workerConfigUrl}/api/v1/work-manager/validate/working-directory`;

    const configStatusPayload: ConfigStatusPayload = {
      configId: payload.configId,
      status: null,
      errorMessage: null,
      fileServerId: payload?.fileServerId || null, // Storage-aware: pass fileServerId for per-zone status updates
    };

    // Storage-aware types (Dell, etc.) use API-based discovery; OtherNAS uses showmount
    const isStorageAware = payload?.serverType !== 'OtherNAS';
    const isPathExists = !!payload?.paths?.length;
    
    // For storage-aware types, exports are discovered via API (stored in VolumeEntity)
    // so paths may be empty but we still have exportsMap to validate
    const hasDiscoveredExports = isStorageAware && payload?.exportsMap && Object.keys(payload.exportsMap).length > 0;
    
    if(!isPathExists && !payload.hasManualUpload && !hasDiscoveredExports) {
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
    const isStorageAware = payload?.serverType !== 'OtherNAS';
    
    try {
      for (const fileServer of payload.listPathPayload) {
        if(fileServer.exportPathSource === ExportPathSource.MANUAL_UPLOAD) {
          this.logger.log(`Skipping mounting and unmounting for MANUAL_UPLOAD type for host ${fileServer.host}`);
          continue;
        }

        // For storage-aware types with SmartConnect FQDN: configure DNS resolver
        // This allows the worker to resolve the SmartConnect FQDN using the SSIP
        
        
        const protocol = this.protocols.getProtocol(ProtocolTypes[fileServer.type]);

        // Configure AD DNS before mount so authentication can resolve the AD server
        if (fileServer.type === ProtocolTypes.SMB && fileServer.dnsServer) {
          await this.configureSmbAdDns(traceId, fileServer.dnsServer);
        }

        // For storage-aware types, get the export path from exportsMap for this specific host
        // This was discovered via storage API and stored in VolumeEntity
        let exportPath = payload.fetchedPath;
        if (isStorageAware){
            // Configure SmartConnect DNS if SSIP and zone are provided
            let clientConfig = new ClientConfig(payload.serverType);
            const storageClient = this.storageClientFactory.getClient(clientConfig);
            if (storageClient) {
              await storageClient.configureSmartConnectDns(traceId, fileServer);
            }
            
            if (payload.exportsMap && payload.exportsMap[fileServer.host]) {
              exportPath = payload.exportsMap[fileServer.host];
              this.logger.log(`Using discovered export path ${exportPath} for host ${fileServer.host}`);
            }
        }
       

        // For storage-aware per-zone, include fileServerId in path to prevent collision between zones
        const uniquePathId = payload.fileServerId ? `${traceId}-${payload.fileServerId}` : traceId;

        const mountPathPayload = {
          hostname: fileServer.host,
          username: fileServer.username,
          password: fileServer.password,
          protocolVersion: fileServer.protocolVersion,
          path: exportPath,
          mountBasePath: this.baseWorkingPath,
          pathId: uniquePathId,
          jobRunId: uniquePathId,
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

    // For storage-aware per-zone, include fileServerId in path to prevent collision between zones
    const uniquePathId = payload.fileServerId ? `${traceId}-${payload.fileServerId}` : traceId;
    const isStorageAware = payload?.serverType !== 'OtherNAS';

    try {
      for (const fileServer of payload.listPathPayload) {
        // Configure AD DNS before mount so authentication can resolve the AD server
        if (fileServer.type === ProtocolTypes.SMB && fileServer.dnsServer) {
          await this.configureSmbAdDns(traceId, fileServer.dnsServer);
        }

        if (isStorageAware){
          let clientConfig = new ClientConfig(payload.serverType);
          const storageClient = this.storageClientFactory.getClient(clientConfig);
          if (storageClient) {
            await storageClient.configureSmartConnectDns(traceId, fileServer);
          }
        }
        const protocol = this.protocols.getProtocol(ProtocolTypes[fileServer.type]);

        const mountPathPayload = {
          hostname: fileServer.host,
          username: fileServer.username,
          password: fileServer.password,
          protocolVersion: fileServer.protocolVersion,
          path: payload.exportPath,
          mountBasePath: this.baseWorkingPath,
          pathId: uniquePathId,
          jobRunId: uniquePathId
        };

        this.logger.log(`Mounting export path for host ${fileServer.host}`);
        await protocol.mountPath(traceId, mountPathPayload, false);
        this.logger.log("Mounted export path successfully");

        this.logger.log("Started validating the working directory");
        const mountPoint = path.join(this.baseWorkingPath, uniquePathId, uniquePathId);
        const fullPath = path.join(mountPoint, payload.workingDirectory);

        if (fs.existsSync(fullPath)) {
          this.logger.log(`Working Directory exists: ${fullPath}`);
          isDirectoryValid = true;

          hasWritePermission = await this.checkWritable(fullPath);

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
 
  async checkWritable(directoryPath: string): Promise<boolean> {
    const testFile = join(directoryPath, '.nfs_write_test');
    try {
      await fsPromises.writeFile(testFile, '');
      await fsPromises.unlink(testFile);
      this.logger.log(`Success: Directory ${directoryPath} is writable.`);
      return true;
    } catch (error) {
      this.logger.error(`Error: No write permission for directory ${directoryPath} - ${error.message}`);
      return false;
    }
  }

  private async configureSmbAdDns(traceId: string, dnsServerIp: string): Promise<void> {
    if (process.platform !== 'win32') return;
  
    try {
      const { stdout } = await execAsync(`netsh interface ip show dns name="Ethernet"`);
      if (stdout.includes(dnsServerIp)) {
        this.logger.log(`[${traceId}] AD DNS ${dnsServerIp} already configured, skipping`);
        return;
      }
      await execAsync(`netsh interface ip add dns name="Ethernet" addr=${dnsServerIp} index=1 validate=no`);
      this.logger.log(`[${traceId}] AD DNS ${dnsServerIp} inserted at index=1 in adapter DNS list`);
    } catch (error) {
      this.logger.warn(`[${traceId}] Failed to configure AD DNS ${dnsServerIp}: ${error.message}`);
    }
  }

}
