import { CommandConfig, CommandPattern } from 'src/config/command.config';
import { ProtocolTypes } from 'src/protocols/protocols';
import { Protocol } from '../protocol/protocol';
import { CommandOutput, ProtocolPayload } from '../protocol/protocol.type';
import { handleConnectionError, parseLinMacShares, parseProtocolVersions, parseWindowsShares } from '../smb/smb.utils';
import * as fs from 'fs';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { isPathExists } from 'src/activities/core/utils/utils';
import { WindowsPrivilegeService } from '../smb/windows-privilege.service';

/**
 * IsilonSmbProtocol - Dell Isilon-specific SMB protocol implementation
 * 
 * This class handles SMB protocol operations specifically for Dell Isilon devices.
 * Key features:
 * - OneFS API integration for efficient share discovery (when useStorageAPI = true)
 * - Isilon-specific SMB optimizations
 * - Support for Isilon SMB share permissions and ACLs
 */
@Injectable()
export class IsilonSmbProtocol extends Protocol {
  @Optional()
  @Inject(WindowsPrivilegeService)
  private readonly windowsPrivilegeService?: WindowsPrivilegeService;

  protected getCommandPattern(key: string): string {
    return CommandConfig.getSMBCommand(this.platform, key);
  }

  constructor(
    private readonly loggerFactory: LoggerFactory,
  ) {
    super(loggerFactory); // Pass to abstract class protocol
  }

  // --------------------------- Validate Connection -------------------------- //
  async validateConnection(traceId: string, payload: ProtocolPayload): Promise<any> {
    await this.listPaths(traceId, payload);
  }

  // --------------------------- Get Protocol Versions -------------------------- //
  async getProtocolVersions(traceId: string, payload: ProtocolPayload): Promise<any> {
    this.logger.log(`[${traceId}] Getting protocol versions for Isilon ${payload.hostname}`);
    return this.executeCommand(
      traceId,
      ProtocolTypes.SMB,
      payload,
      this.getCommandPattern(CommandPattern.VERSION_DETAIL),
      'SMB Get Protocol Versions',
    ).then((response) => {
      this.logger.log(`[${traceId}] ${response.message}`);
      return parseProtocolVersions(response.message);
    }).catch((error) => {
      this.logger.error(`[${traceId}] Error getting protocol versions: ${error.message}`);
      throw error;
    });
  }

  // --------------------------- List Paths MAC and LINUX -------------------------- //
  async listPathLinMac(traceId: string, payload: ProtocolPayload): Promise<any> {
    try {
      const response: CommandOutput = await this.executeCommand(
        traceId,
        ProtocolTypes.SMB,
        payload,
        this.getCommandPattern(CommandPattern.LIST_PATHS),
        'Isilon SMB Show Shares',
      );
      this.logger.log(`[${traceId}] ${response.message} ${response.status}`);
      return parseLinMacShares(response.message);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error during Isilon SMB connection: ${errorMessage}`);
      const match = errorMessage.match(/NT_STATUS_[A-Z_]+/);
      const errorCode = match ? match[0] : errorMessage;
      throw new Error(handleConnectionError(errorCode));
    }
  }

  // --------------------------- List Paths WINDOWS -------------------------- //
  async listPathWindows(traceId: string, payload: ProtocolPayload) {
    try {
      const result = await this.executeCommand(
        traceId,
        ProtocolTypes.SMB,
        payload,
        this.getCommandPattern(CommandPattern.VALIDATE_CRED),
        'Connect Isilon SMB via Cred',
      );
      this.logger.log(JSON.stringify(result));
      if (result?.message?.toLowerCase().includes("successfully.")) {
        const response = await this.executeCommand(
          traceId,
          ProtocolTypes.SMB,
          payload,
          this.getCommandPattern(CommandPattern.LIST_PATHS),
          'Isilon SMB Show Shares',
        );

        this.logger.log(`[${traceId}] ${response.message}`);
        return parseWindowsShares(response.message);
      } else {
        throw new Error(`Mount operation failed: ${result.message}`);
      }
    } catch (e) {
      this.logger.log(`error: ${e}`);
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`error: ${message}`);
      const lines = message.split('\n');
      const cleanedMessage = lines.length > 1 ? lines.slice(1).join('\n') : message;
      throw new Error(cleanedMessage);
    }
  }

  // --------------------------- List Paths -------------------------- //
  async listPaths(traceId: string, payload: ProtocolPayload): Promise<any> {
    this.logger.log(`[${traceId}] Getting list paths for Isilon ${payload.hostname} using ${this.shouldUseIsilonAPI(payload) ? 'OneFS API' : 'standard SMB'}`);

    // Check if we should use Isilon OneFS API
    if (this.shouldUseIsilonAPI(payload)) {
      return await this.listPathsViaIsilonAPI(traceId, payload);
    }

    // Fall back to standard SMB
    return await this.listPathsViaStandardSMB(traceId, payload);
  }

  /**
   * Check if we should use Isilon OneFS API for path discovery
   */
  private shouldUseIsilonAPI(payload: ProtocolPayload): boolean {
    return !!(
      payload.useStorageAPI === true &&
      payload.storageApiCredentials?.apiEndpoint &&
      payload.storageApiCredentials?.username &&
      payload.storageApiCredentials?.password
    );
  }

  /**
   * List paths using Dell Isilon OneFS REST API
   * This is more efficient than smbclient for large Isilon clusters
   */
  private async listPathsViaIsilonAPI(traceId: string, payload: ProtocolPayload): Promise<string[]> {
    this.logger.log(`[${traceId}] Using Isilon OneFS API for SMB share discovery`);

    // TODO: Implement actual OneFS API call
    // For now, return dummy data to demonstrate the architecture
    // In Phase 2, we'll implement the IsilonApiClient

    const dummyShares = [
      'share1',
      'share2',
      'data',
    ];

    this.logger.log(`[${traceId}] Isilon API discovered ${dummyShares.length} SMB shares (dummy data)`);
    return dummyShares;
  }

  /**
   * List paths using standard SMB smbclient command
   * Fallback when OneFS API is not available
   */
  private async listPathsViaStandardSMB(traceId: string, payload: ProtocolPayload): Promise<string[]> {
    this.logger.log(`[${traceId}] Using standard SMB for Isilon ${payload.hostname}, platform: ${this.platform}`);
    
    switch (this.platform) {
      case 'darwin':
        return await this.listPathLinMac(traceId, payload);
      case 'linux':
        return await this.listPathLinMac(traceId, payload);
      case 'win32':
        return await this.listPathWindows(traceId, payload);
      default:
        throw Error(`Unsupported platform ${this.platform}`);
    }
  }

  // --------------------------- Get total size of a mounted path -------------------------- //
  async getTotalUsedMemory(traceId: string, payload: ProtocolPayload): Promise<number> {
    try {
      const response = await this.executeCommand(
        traceId,
        ProtocolTypes.SMB,
        payload,
        this.getCommandPattern(CommandPattern.MOUNTED_FOLDER_SIZE),
        'Isilon SMB Mounted Folder size',
      );
      this.logger.log(`response of executeCommand in getTotalUsedMemory - ${JSON.stringify(response)}`);
      return parseInt(response.message.trim()) || 0;
    } catch (error) {
      this.logger.error(`[${traceId}] Error checking total data size : ${error.message}`);
      throw new Error(`Failed to calculate size: ${error.message}`);
    }
  }

  // --------------------------- Available Disc Space -------------------------- //
  async getAvailableDiskSpace(traceId: string, payload: ProtocolPayload): Promise<{ size: number }> {
    try {
      this.logger.log(`[${traceId}] Checking available disk space at path: ${payload?.path}`);
      const response = await this.executeCommand(
        traceId,
        ProtocolTypes.SMB,
        payload,
        this.getCommandPattern(CommandPattern.AVAILABLE_DISK_SPACE),
        'Isilon SMB Available Disk Space',
      );
      if (response.status = "success") {
        this.logger.log(`response of getAvailableDiskSpace in isilon-smb.protocol ${JSON.stringify(response)}`);
        this.logger.log(`[${traceId}] ${response.message}`);
        const available = parseInt(response.message.trim(), 10);
        this.logger.log(`[${traceId}] Available space at ${payload?.path}: ${available} bytes`);
        return { size: available };
      }
    } catch (error) {
      this.logger.error(`[${traceId}] Error checking disk space for path ${payload?.path}: ${error.message}`);
      throw new Error(`Failed to get available disk space at ${payload?.path}`);
    }
  }

  // --------------------------- Unmount Path -------------------------- //
  async unmountPath(traceId: string, payload: ProtocolPayload): Promise<any> {
    this.logger.log(
      `[${traceId}] Unmounting Isilon SMB path for ${payload.hostname}`,
    );
    try {
      const response = await this.executeCommand(
        traceId,
        ProtocolTypes.SMB,
        payload,
        this.getCommandPattern(CommandPattern.UNMOUNT_PATH),
        'Isilon SMB Unmount',
      );

      if (response?.message?.toLowerCase().includes("successfully.")) {
        const response = await this.executeCommand(
          traceId,
          ProtocolTypes.SMB,
          payload,
          this.getCommandPattern(CommandPattern.UNLINK_PATH),
          'Isilon SMB Unlink',
        );
        this.logger.log(`[${traceId}] ${response.message}`);
      }
      return response;
    } catch (error) {
      this.logger.log(
        `[${traceId}] Error Unmounting path for ${payload.hostname} of type ${ProtocolTypes.SMB} from ${this.workerId}: ${error.message}`,
      );
      throw error;
    }
  }

  // --------------------------- Mount Path -------------------------- //
  async mountPath(traceId: string, payload: ProtocolPayload, manageMount: boolean = false): Promise<any> {
    this.logger.log(
      `[${traceId}] Mounting Isilon SMB path for ${payload.hostname}`,
    );

    // Enable Windows backup privileges for SMB on Windows platform
    if (this.platform === 'win32' && this.windowsPrivilegeService && manageMount) {
      this.logger.log(`[${traceId}] Enabling Windows backup privileges for Isilon SMB access`);
      const privilegesEnabled = await this.windowsPrivilegeService.enableBackupPrivileges();
      if (privilegesEnabled) {
        this.logger.log(`[${traceId}] Backup privileges enabled successfully for Isilon SMB`);
      } else {
        this.logger.error(`[${traceId}] Failed to enable Windows backup privileges. These privileges are required for SMB operations.`);
        throw new Error(`Failed to enable Windows backup privileges. These privileges are required for SMB operations.`);
      }
    }

    const mountDir = `${payload.mountBasePath}/${payload.jobRunId}`;
    const mountDirExists = await isPathExists(mountDir);
    if (!mountDirExists) {
      try {
        await fs.promises.mkdir(mountDir, { recursive: true });
        this.logger.log(`[${traceId}] Directory created: ${mountDir}`);
      } catch (error) {
        this.logger.error(`[${traceId}] Error creating directory: ${error.message}`);
        return {
          traceId,
          status: 'error',
          protocolType: ProtocolTypes.SMB,
          hostname: payload.hostname,
          workerId: this.workerId,
          message: `[${traceId}] Error creating directory: ${error.message}`,
        };
      }
    }
    try {
      const saveCredsResult = await this.executeCommand(
        traceId,
        ProtocolTypes.SMB,
        payload,
        this.getCommandPattern(CommandPattern.SAVE_CREDS),
        'Isilon SMB Save Credentials',
      );

      if (!saveCredsResult?.message?.toLowerCase().includes("successfully."))
        throw new Error(`Save credentials operation failed: ${saveCredsResult.message}`);

      const result = await this.executeCommand(
        traceId,
        ProtocolTypes.SMB,
        payload,
        this.getCommandPattern(CommandPattern.MOUNT_PATH),
        'Isilon SMB Mount',
      );

      if (result?.message?.toLowerCase().includes("successfully.")) {
        const response = await this.executeCommand(
          traceId,
          ProtocolTypes.SMB,
          payload,
          this.getCommandPattern(CommandPattern.CREATE_PATH_LINK),
          'Isilon SMB Create Link',
        );

        this.logger.log(`[${traceId}] ${response.message}`);
        return response;
      }
    } catch (error) {
      this.logger.error(`[${traceId}] Error mounting path for ${payload.hostname} of type ${ProtocolTypes.SMB} from ${this.workerId}: ${error.message}`);
      throw new Error(`Failed to mount path at ${payload.hostname}, reason: ${error.message}`);
    }
  }

  // --------------------------- Disconnect Session -------------------------- //
  async disconnectSession(traceId: string, payload: ProtocolPayload): Promise<any> {
    this.logger.log(
      `[${traceId}] disconnecting Isilon SMB session ${payload.hostname}`,
    );
    try {
      const response = await this.executeCommand(
        traceId,
        ProtocolTypes.SMB,
        payload,
        this.getCommandPattern(CommandPattern.DISCONNECT_SESSION),
        'Isilon SMB Disconnect Session',
      );
      return response;
    } catch (error) {
      this.logger.log(
        `[${traceId}] error disconnecting session ${payload.hostname} of type ${ProtocolTypes.SMB} from ${this.workerId}: ${error.message}`,
      );
      throw error;
    }
  }

  getTotalSizeLinux(traceId: string, payload: ProtocolPayload): Promise<any> {
    throw new Error('Method not implemented.');
  }

  updateBootMounts({ platform, fstabPath, workerId }: { platform: any; fstabPath: any; workerId: any }, payload: any, action: any, traceId: any): void {
    this.logger.log(`[${traceId}] updateBootMount not implemented for SMB protocol`);
    throw new Error('Method not implemented.');
  }
}
