import { CommandConfig, CommandPattern } from 'src/config/command.config';
import { ProtocolTypes } from 'src/protocols/protocols';
import { Protocol } from '../protocol/protocol';
import { ProtocolPayload } from '../protocol/protocol.type';
import { parseExports } from '../nfs/nfs.utils';
import * as fs from 'fs';
import { Injectable, Logger } from '@nestjs/common';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { isPathExists } from 'src/activities/core/utils/utils';

/**
 * IsilonNfsProtocol - Dell Isilon-specific NFS protocol implementation
 * 
 * This class handles NFS protocol operations specifically for Dell Isilon devices.
 * Key features:
 * - OneFS API integration for efficient path discovery (when useStorageAPI = true)
 * - Isilon-specific NFS mount options (rsize=131072, wsize=131072)
 * - Path normalization to handle /ifs prefix
 * - Optimized for Isilon's OneFS file system architecture
 */
@Injectable()
export class IsilonNfsProtocol extends Protocol {
  protected getCommandPattern(key: string): string {
    return CommandConfig.getNFSCommand(this.platform, key);
  }

  protected getFstabPath(path: string): string {
    return CommandConfig.getFstabPath(this.platform, path);
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
      ProtocolTypes.NFS,
      payload,
      this.getCommandPattern(CommandPattern.VERSION_DETAIL),
      'NFS Get Protocol Versions',
    ).then((response) => {
      this.logger.log(`[${traceId}] ${response.message}`);
      return response;
    });
  }

  // --------------------------- List Paths -------------------------- //
  async listPaths(traceId: string, payload: ProtocolPayload): Promise<any> {
    this.logger.log(`[${traceId}] Getting list paths for Isilon ${payload.hostname} using ${this.shouldUseIsilonAPI(payload) ? 'OneFS API' : 'standard NFS'}`);

    // Check if we should use Isilon OneFS API
    if (this.shouldUseIsilonAPI(payload)) {
      return await this.listPathsViaIsilonAPI(traceId, payload);
    }

    // Fall back to standard NFS showmount
    return await this.listPathsViaShowmount(traceId, payload);
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
   * This is more efficient than showmount for large Isilon clusters
   */
  private async listPathsViaIsilonAPI(traceId: string, payload: ProtocolPayload): Promise<string[]> {
    this.logger.log(`[${traceId}] Using Isilon OneFS API for path discovery`);

    // TODO: Implement actual OneFS API call
    // For now, return dummy data to demonstrate the architecture
    // In Phase 2, we'll implement the IsilonApiClient

    const dummyPaths = [
      '/ifs/data/share1',
      '/ifs/data/share2',
      '/ifs/home',
    ];

    this.logger.log(`[${traceId}] Isilon API discovered ${dummyPaths.length} paths (dummy data)`);
    
    // Normalize paths - remove /ifs prefix for user-facing paths
    return dummyPaths.map(path => this.normalizeIsilonPath(path));
  }

  /**
   * List paths using standard NFS showmount command
   * Fallback when OneFS API is not available
   */
  private async listPathsViaShowmount(traceId: string, payload: ProtocolPayload): Promise<string[]> {
    this.logger.log(`[${traceId}] Using standard showmount for Isilon ${payload.hostname}`);
    
    return this.executeCommand(
      traceId,
      ProtocolTypes.NFS,
      payload,
      this.getCommandPattern(CommandPattern.LIST_PATHS),
      'NFS Show Mount',
    ).then((response) => {
      this.logger.log(`[${traceId}] ${response.message}`);
      const paths = parseExports(response.message);
      
      // Normalize Isilon paths
      return paths.map(path => this.normalizeIsilonPath(path));
    });
  }

  /**
   * Normalize Isilon paths - remove /ifs prefix if present
   * Isilon internally uses /ifs but exports may not include it
   */
  private normalizeIsilonPath(path: string): string {
    if (path.startsWith('/ifs/')) {
      return path.substring(4); // Remove '/ifs'
    }
    return path;
  }

  // --------------------------- Get total size of a mounted path -------------------------- //
  async getTotalUsedMemory(traceId: string, payload: ProtocolPayload): Promise<number> {
    try {
      const response = await this.executeCommand(
        traceId,
        ProtocolTypes.NFS,
        payload,
        this.getCommandPattern(CommandPattern.MOUNTED_FOLDER_SIZE),
        'NFS Mounted Folder size',
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
        ProtocolTypes.NFS,
        payload,
        this.getCommandPattern(CommandPattern.AVAILABLE_DISK_SPACE),
        'NFS Available Disk Space',
      );
      if (response.status = "success") {
        this.logger.log(`response of getAvailableDiskSpace in nfs.protocol ${JSON.stringify(response)}`);
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

  // --------------------------- Mount Path -------------------------- //
  async mountPath(traceId: string, payload: ProtocolPayload, manageMount: boolean): Promise<any> {
    this.logger.log(
      `[${traceId}] Mounting Isilon NFS path for ${payload.hostname} with optimized mount options`,
    );

    // If using Isilon API mode (dummy data), skip actual mounting
    if (this.shouldUseIsilonAPI(payload)) {
      this.logger.log(`[${traceId}] Isilon API mode - skipping actual mount (dummy data)`);
      return {
        traceId,
        status: 'success',
        protocolType: ProtocolTypes.NFS,
        hostname: payload.hostname,
        workerId: this.workerId,
        message: `[${traceId}] Isilon API mode - mount simulated successfully`,
      };
    }

    const mountDir = `${payload.mountBasePath}/${payload.jobRunId}/${payload.pathId}`;
    try {
      await fs.promises.access(mountDir, fs.constants.F_OK);
      this.logger.log(`[${traceId}] Directory already exists: ${mountDir}`);
      return {
        traceId,
        status: 'error',
        protocolType: ProtocolTypes.NFS,
        hostname: payload.hostname,
        workerId: this.workerId,
        message: `[${traceId}] Directory already exists: ${mountDir}`,
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        try {
          await fs.promises.mkdir(mountDir, { recursive: true });
          this.logger.log(`[${traceId}] Directory created: ${mountDir}`);
        } catch (mkdirError) {
          this.logger.error(`[${traceId}] Error creating directory: ${mkdirError.message}`);
          return {
            traceId,
            status: 'error',
            protocolType: ProtocolTypes.NFS,
            hostname: payload.hostname,
            workerId: this.workerId,
            message: `[${traceId}] Error creating directory: ${mkdirError.message}`,
          };
        }
      }
    }

    // Use Isilon-optimized mount options
    // Isilon performs best with larger rsize/wsize (128KB)
    const isilonOptimizedPayload = {
      ...payload,
      mountOptions: 'rsize=131072,wsize=131072,tcp,hard,intr,timeo=600,retrans=2',
    };

    const mountResult = await this.executeCommand(
      traceId,
      ProtocolTypes.NFS,
      isilonOptimizedPayload,
      this.getCommandPattern(CommandPattern.MOUNT_PATH),
      'Isilon NFS Mount (Optimized)',
    );
    await new Promise((resolve) => setTimeout(resolve, 5000));
    this.logger.log(`[${traceId}] Mount result: ${JSON.stringify(mountResult)}`);

    if (manageMount && mountResult.status === 'success') {
      this.updateBootMounts(
        {
          platform: this.platform,
          fstabPath: this.getFstabPath(CommandPattern.FSTAB_PATH),
          workerId: this.workerId,
        },
        isilonOptimizedPayload,
        'insert',
        traceId
      );
    }
    return mountResult;
  }

  // --------------------------- Unmount Path -------------------------- //
  async unmountPath(traceId: string, payload: ProtocolPayload, manageMount: boolean): Promise<any> {
    this.logger.log(
      `[${traceId}] Unmounting Isilon NFS path for ${payload.hostname}`,
    );

    // If using Isilon API mode (dummy data), skip actual unmounting
    if (this.shouldUseIsilonAPI(payload)) {
      this.logger.log(`[${traceId}] Isilon API mode - skipping actual unmount (dummy data)`);
      return {
        traceId,
        status: 'success',
        protocolType: ProtocolTypes.NFS,
        hostname: payload.hostname,
        workerId: this.workerId,
        message: `[${traceId}] Isilon API mode - unmount simulated successfully`,
      };
    }

    const response = await this.executeCommand(
      traceId,
      ProtocolTypes.NFS,
      payload,
      this.getCommandPattern(CommandPattern.UNMOUNT_PATH),
      'Isilon NFS Unmount',
    );

    if (response['status'] === 'success') {
      const mountDir = `${payload.mountBasePath}/${payload.jobRunId}/${payload.pathId}`;
      const mountDirExists = await isPathExists(mountDir);
      if (mountDirExists && mountDir.startsWith(payload.mountBasePath)) {
        await fs.promises.rmdir(mountDir, { recursive: true });
        this.logger.log(`[${traceId}] Directory removed: ${mountDir}`);
      } else {
        this.logger.log(`[${traceId}] Directory does not exist: ${mountDir}`);
      }

      if (manageMount) {
        this.updateBootMounts(
          {
            platform: this.platform,
            fstabPath: this.getFstabPath(CommandPattern.FSTAB_PATH),
            workerId: this.workerId,
          },
          payload,
          'delete',
          traceId
        );
      }
      return response;
    }
  }

  getTotalSizeLinux(traceId: string, payload: ProtocolPayload): Promise<any> {
    throw new Error('Method not implemented.');
  }

  disconnectSession(traceId: string, payload: ProtocolPayload): Promise<any> {
    throw new Error('Method not implemented.');
  }

  // This file updates the /etc/fstab file to ensure that the mount persists across reboots.
  public updateBootMounts({ platform, fstabPath, workerId }, payload: ProtocolPayload, action, traceId) {
    try {
      const mountDir = `${payload.mountBasePath}/${payload.jobRunId}/${payload.pathId}`;
      const fstabEntry = `${payload.hostname}:${payload.path} ${mountDir} nfs defaults 0 0\n`;
      if (platform === 'linux') {
        const fstabContent = fs.readFileSync(fstabPath, 'utf-8');
        const entryExists = fstabContent.includes(fstabEntry);

        if (action === 'insert') {
          if (!entryExists) {
            fs.appendFileSync(fstabPath, fstabEntry);
            this.logger.log(`[${traceId}] Added entry to ${fstabPath}`);
          } else {
            this.logger.log(`[${traceId}] Entry already exists in /etc/fstab`);
          }
        } else if (action === 'delete') {
          if (entryExists) {
            const filteredLines = fstabContent
              .split('\n')
              .filter(line => line.trim() !== fstabEntry.trim());
            let newContent = filteredLines.join('\n');
            // Preserve original ending newline if present
            if (fstabContent.endsWith('\n') && newContent.length > 0) {
              newContent += '\n';
            }
            fs.writeFileSync(fstabPath, newContent);
            this.logger.log(`[${traceId}] Removed entry from /etc/fstab`);
          } else {
            this.logger.log(`[${traceId}] Entry not found in /etc/fstab`);
          }
        } else {
          this.logger.error(`[${traceId}] Unknown action: ${action}`);
          return {
            traceId,
            status: 'error',
            protocolType: 'NFS',
            hostname: payload.hostname,
            workerId,
            message: `[${traceId}] Unknown action: ${action}`,
          };
        }
      }
    } catch (error) {
      this.logger.error(`[${traceId}] Error updating /etc/fstab: ${error.message}`);
      return {
        traceId,
        status: 'error',
        protocolType: 'NFS',
        hostname: payload.hostname,
        workerId,
        message: `[${traceId}] Error updating /etc/fstab: ${error.message}`,
      };
    }
  }
}
