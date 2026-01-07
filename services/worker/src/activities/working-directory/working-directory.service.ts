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
      errorMessage: null,
      fileServerId: payload?.fileServerId || null, // Dell per-zone: pass fileServerId for per-zone status updates
    };

    const isDell = payload?.isDell || payload?.serverType === 'Dell';
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
    const isDell = payload?.isDell || payload?.serverType === 'Dell';
    
    try {
      for (const fileServer of payload.listPathPayload) {
        if(fileServer.exportPathSource === ExportPathSource.MANUAL_UPLOAD) {
          this.logger.log(`Skipping mounting and unmounting for MANUAL_UPLOAD type for host ${fileServer.host}`);
          continue;
        }

        // For Dell Isilon with SmartConnect FQDN on Linux: configure DNS resolver
        // This allows the worker to resolve the SmartConnect FQDN using the SSIP
        if (isDell && fileServer.smartConnectSsip && fileServer.smartConnectDnsZone) {
          await this.configureSmartConnectDns(traceId, fileServer.smartConnectSsip, fileServer.smartConnectDnsZone);
        }
        
        const protocol = this.protocols.getProtocol(ProtocolTypes[fileServer.type]);

        // For Dell, get the export path from dellExportsMap for this specific host
        // This was discovered via Isilon API and stored in VolumeEntity
        let exportPath = payload.fetchedPath;
        if (isDell && payload.dellExportsMap && payload.dellExportsMap[fileServer.host]) {
          exportPath = payload.dellExportsMap[fileServer.host];
          this.logger.log(`Dell Isilon: Using discovered export path ${exportPath} for host ${fileServer.host}`);
        }

        // For Dell per-zone, include fileServerId in path to prevent collision between zones
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

    // For Dell per-zone, include fileServerId in path to prevent collision between zones
    const uniquePathId = payload.fileServerId ? `${traceId}-${payload.fileServerId}` : traceId;
    const isDell = payload?.isDell || payload?.serverType === 'Dell';

    try {
      for (const fileServer of payload.listPathPayload) {
        // For Dell Isilon with SmartConnect FQDN: configure DNS resolver
        if (isDell && fileServer.smartConnectSsip && fileServer.smartConnectDnsZone) {
          await this.configureSmartConnectDns(traceId, fileServer.smartConnectSsip, fileServer.smartConnectDnsZone);
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

  /**
   * Configure DNS resolver for Dell Isilon SmartConnect FQDN resolution
   * This adds the SmartConnect SSIP as a nameserver for the SmartConnect DNS zone
   * Supports Linux, macOS, and Windows workers
   * 
   * @param traceId - Trace ID for logging
   * @param ssip - SmartConnect Service IP (SSIP) - the DNS server for the zone
   * @param dnsZone - SmartConnect DNS zone (e.g., "lab.local")
   */
  private async configureSmartConnectDns(traceId: string, ssip: string, dnsZone: string): Promise<void> {
    this.logger.log(`[${traceId}] Configuring SmartConnect DNS: SSIP=${ssip}, Zone=${dnsZone}, Platform=${process.platform}`);
    
    try {
      switch (process.platform) {
        case 'linux':
          await this.configureSmartConnectDnsLinux(traceId, ssip, dnsZone);
          break;
        case 'darwin':
          await this.configureSmartConnectDnsMacOS(traceId, ssip, dnsZone);
          break;
        case 'win32':
          await this.configureSmartConnectDnsWindows(traceId, ssip, dnsZone);
          break;
        default:
          this.logger.warn(`[${traceId}] Unsupported platform for DNS configuration: ${process.platform}`);
      }
    } catch (error) {
      // Don't fail the workflow if DNS configuration fails - the mount might still work
      // if the host is an IP address or already resolvable
      this.logger.warn(`[${traceId}] Failed to configure SmartConnect DNS: ${error.message}. Mount may fail if host is FQDN.`);
    }
  }

  /**
   * Configure DNS for Linux by modifying /etc/resolv.conf
   */
  private async configureSmartConnectDnsLinux(traceId: string, ssip: string, dnsZone: string): Promise<void> {
    const resolvConfPath = '/etc/resolv.conf';
    const nameserverEntry = `nameserver ${ssip}`;
    const searchEntry = `search ${dnsZone}`;
    
    // Read current resolv.conf
    let currentContent = '';
    try {
      currentContent = fs.readFileSync(resolvConfPath, 'utf-8');
    } catch (readError) {
      this.logger.warn(`[${traceId}] Could not read ${resolvConfPath}: ${readError.message}`);
    }
    
    // Check if SSIP is already configured
    if (currentContent.includes(nameserverEntry)) {
      this.logger.log(`[${traceId}] SmartConnect SSIP ${ssip} already configured in ${resolvConfPath}`);
      return;
    }
    
    // Prepend the SmartConnect SSIP as the first nameserver
    const lines = currentContent.split('\n');
    const newLines: string[] = [];
    
    // Add SmartConnect SSIP as first nameserver
    newLines.push(nameserverEntry);
    
    // Add search domain if not already present
    let hasSearchDomain = false;
    for (const line of lines) {
      if (line.startsWith('search ')) {
        // Append our DNS zone to existing search line if not present
        if (!line.includes(dnsZone)) {
          newLines.push(`${line} ${dnsZone}`);
        } else {
          newLines.push(line);
        }
        hasSearchDomain = true;
      } else if (line.trim()) {
        newLines.push(line);
      }
    }
    
    // Add search line if none exists
    if (!hasSearchDomain) {
      newLines.push(searchEntry);
    }
    
    // Write updated resolv.conf
    const newContent = newLines.join('\n') + '\n';
    fs.writeFileSync(resolvConfPath, newContent);
    
    this.logger.log(`[${traceId}] Linux: SmartConnect DNS configured successfully`);
  }

  /**
   * Configure DNS for macOS by creating a resolver file in /etc/resolver/
   * This is the recommended way to add DNS for specific domains on macOS
   */
  private async configureSmartConnectDnsMacOS(traceId: string, ssip: string, dnsZone: string): Promise<void> {
    const resolverDir = '/etc/resolver';
    const resolverFile = path.join(resolverDir, dnsZone);
    
    // Check if already configured
    if (fs.existsSync(resolverFile)) {
      const content = fs.readFileSync(resolverFile, 'utf-8');
      if (content.includes(ssip)) {
        this.logger.log(`[${traceId}] SmartConnect SSIP ${ssip} already configured for ${dnsZone}`);
        return;
      }
    }
    
    // Create resolver directory if it doesn't exist
    if (!fs.existsSync(resolverDir)) {
      fs.mkdirSync(resolverDir, { recursive: true });
    }
    
    // Create resolver file for the DNS zone
    const resolverContent = `# SmartConnect DNS resolver for Dell Isilon\nnameserver ${ssip}\n`;
    fs.writeFileSync(resolverFile, resolverContent);
    
    this.logger.log(`[${traceId}] macOS: SmartConnect DNS configured at ${resolverFile}`);
  }

  /**
   * Configure DNS for Windows using PowerShell to add DNS client configuration
   * Uses Add-DnsClientNrptRule to add a Name Resolution Policy Table rule
   */
  private async configureSmartConnectDnsWindows(traceId: string, ssip: string, dnsZone: string): Promise<void> {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    // Check if rule already exists
    const checkCmd = `powershell -Command "Get-DnsClientNrptRule | Where-Object { $_.Namespace -eq '.${dnsZone}' }"`;
    
    try {
      const { stdout } = await execPromise(checkCmd);
      if (stdout && stdout.trim()) {
        this.logger.log(`[${traceId}] SmartConnect DNS rule already exists for ${dnsZone}`);
        return;
      }
    } catch (checkError) {
      // Rule doesn't exist, continue to create it
    }
    
    // Add NRPT rule for the DNS zone
    // This tells Windows to use the SSIP as DNS server for the specified zone
    const addCmd = `powershell -Command "Add-DnsClientNrptRule -Namespace '.${dnsZone}' -NameServers '${ssip}'"`;
    
    try {
      await execPromise(addCmd);
      this.logger.log(`[${traceId}] Windows: SmartConnect DNS NRPT rule added for ${dnsZone} -> ${ssip}`);
    } catch (addError) {
      // Fallback: Try adding to hosts file or using netsh
      this.logger.warn(`[${traceId}] Failed to add NRPT rule: ${addError.message}. Trying alternative method...`);
      
      // Alternative: Use netsh to set DNS server (requires admin)
      const netshCmd = `netsh interface ip add dns name="Ethernet" addr=${ssip} index=1`;
      try {
        await execPromise(netshCmd);
        this.logger.log(`[${traceId}] Windows: SmartConnect DNS added via netsh`);
      } catch (netshError) {
        throw new Error(`Could not configure DNS: ${netshError.message}`);
      }
    }
  }

}
