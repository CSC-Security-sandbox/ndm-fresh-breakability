import { CommandConfig, CommandPattern } from 'src/config/command.config';
import { Protocol } from 'src/protocols/protocol/protocol';
import { handleConnectionError, parseExports, parseProtocolVersions } from './nfs.utils';
import * as net from 'net';
import { ProtocolTypes } from 'src/protocols/protocols';
import { ProtocolPayload } from 'src/protocols/protocol/protocol.type'; 
import * as fs from 'fs';
import { Injectable } from '@nestjs/common';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { isPathExists } from 'src/activities/core/utils/utils';

@Injectable()
export class NFSProtocol extends Protocol {

  protected getCommandPattern( key : string): string {
    return CommandConfig.getNFSCommand(this.platform, key)
  }

  constructor(private readonly loggerFactory: LoggerFactory) {
    super(loggerFactory); // Pass to abstract class protocol
  }

  // --------------------------- Validate Connection -------------------------- //
  async validateConnection(traceId:string, options: ProtocolPayload ): Promise<any> {
    const client = new net.Socket();
    const timeout = 2000;
    try {
      this.logger.log(`[${traceId}] Attempting to connect... Protocol: ${ProtocolTypes.NFS}`);
      await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            client.destroy();
            reject(new Error(`Connection timed out`));
          }, timeout);
          client.connect(2049, options.hostname, () => {
              clearTimeout(timer);
              resolve();
          });
          client.on('error', (err) => {
              clearTimeout(timer);
              reject(err);
          });
      });

      this.logger.log(`[${traceId}] Connection established for Protocol: ${ProtocolTypes.NFS}`);
      return 'Connection established';
    } catch (error) {
        this.logger.error(`Error during connection: ${error.message}`);
        throw new Error(handleConnectionError(error, options.hostname, 2049));
    } finally {
        client.end();
        client.destroy();
    }
  }

  // --------------------------- Get Protocol Versions -------------------------- //
  async getProtocolVersions(traceId: string, payload: ProtocolPayload): Promise<string[]> {
    this.logger.log(
      `[${traceId}] Getting protocols for ${payload.hostname} of type ${ProtocolTypes.NFS} from ${this.workerId}`,
    );
    return this.executeCommand(
      traceId,
      ProtocolTypes.NFS,
      payload,
      this.getCommandPattern(CommandPattern.VERSION_DETAIL),
      'NFS Get Protocols',
    ).then((response) => {
      this.logger.log(`[${traceId}] ${response.message}`);
      return parseProtocolVersions(response.message);
    });
  }


  // --------------------------- List Paths -------------------------- //
  async listPaths(traceId: string, payload: ProtocolPayload): Promise<string[]> {
    this.logger.log(
      `[${traceId}] Getting list paths for ${payload.hostname} of type ${ProtocolTypes.NFS} from ${this.workerId}`,
    );
    return this.executeCommand(
      traceId,
      ProtocolTypes.NFS,
      payload,
      this.getCommandPattern(CommandPattern.LIST_PATHS),
      'NFS Show Mount',
    ).then((response) => {
      this.logger.log(`[${traceId}] ${response.message}`);
      return parseExports(response.message);
    });
  }

    // --------------------------- Available Disc Space -------------------------- //
  async getAvailableDiskSpace(traceId: string, payload: ProtocolPayload): Promise<{ size: number }> {
    try {
      this.logger.log(`[${traceId}] Checking available disk space at path: ${payload?.path}`);
      return this.executeCommand(
        traceId,
        ProtocolTypes.NFS,
        payload,
        this.getCommandPattern(CommandPattern.AVAILABLE_DISK_SPACE),
        'NFS path Available Disk Space',
      ).then((response) => {
        this.logger.log(`response of getAvailableDiskSpace in nfs.protocol ${JSON.stringify(response)}`);
        this.logger.log(`[${traceId}] ${response.message}`);
        const availableBytes = parseInt(response.message.trim(), 10);
        this.logger.log(`[${traceId}] Available space at ${payload?.path}: ${availableBytes} bytes`);
        return { size: availableBytes };
      });
     
    } catch (error) {
      this.logger.error(`[${traceId}] Error checking disk space for path ${payload?.path}: ${error.message}`);
      throw new Error(`Failed to get available disk space at ${payload?.path}`);
    }
  }

  // --------------------------- Get total size of a mounted path -------------------------- //
  async getTotalUsedMemory(traceId: string, payload: ProtocolPayload): Promise<number> {
    this.logger.log(`[${traceId}] Checking total size of a mounted path: ${payload?.path}`);
    try {
      return this.executeCommand(
        traceId,
        ProtocolTypes.NFS,
        payload,
        this.getCommandPattern(CommandPattern.MOUNTED_FOLDER_SIZE),
        'NFS Mounted Folder size',
      ).then((response) => {
        this.logger.log(`response of executeCommand in getTotalUsedMemory - ${JSON.stringify(response)}`);
        this.logger.log(`[${traceId}] ${response.message}`);

        let usedBytes: number;

        if (this.platform === 'linux' || this.platform === 'darwin') {
          const parts = response.message.trim().split(/\s+/);
          if (parts.length < 3) {
            throw new Error(`Unexpected df output: ${response.message}`);
          }

          usedBytes = parseInt(parts[2], 10);
          if (this.platform === 'darwin') {
            usedBytes *= 1024;
          }
        }
        this.logger.log(`[${traceId}] Calculated data size for ${payload?.path}: ${usedBytes} bytes`);
        return usedBytes;
      });
    } catch (error) {
      this.logger.error(`[${traceId}] Error checking total data size for ${payload.path} : ${error.message}`);
      throw new Error(`Failed to calculate size: ${error.message}`);
    }
  }

  async unmountPath(traceId: string, payload: any): Promise<any> {
    this.logger.log(
      `[${traceId}] Unmounting path for ${payload.hostname} of type ${ProtocolTypes.NFS} from ${this.workerId} with payload: ${JSON.stringify(payload)}`,
    );

    const response = await this.executeCommand(
      traceId,
      ProtocolTypes.NFS,
      payload,
      this.getCommandPattern(CommandPattern.UNMOUNT_PATH),
      'NFS Unmount',
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
      
      return response;
    }
  }

  async mountPath(traceId: string, payload: any): Promise<any> {
   console.log(
      `[${traceId}] Mounting path for ${payload.hostname} of type ${payload} from ${this.workerId}`,
    );

    const mountDir = `${payload.mountBasePath}/${payload.jobRunId}/${payload.pathId}`;    
    try{
      await fs.promises.access(mountDir, fs.constants.F_OK);
      this.logger.log(`[${traceId}] Directory already exists: ${mountDir}`);
      return {
        traceId,
        status: 'error',
        protocolType: ProtocolTypes.NFS,
        hostname: payload.hostname,
        workerId: this.workerId,
        message: `[${traceId}] Directory already exists: ${mountDir}`,
      }
    }catch(error){
      if (error.code === 'ENOENT') {
        try{
           await fs.promises.mkdir(mountDir, { recursive: true });
           this.logger.log(`[${traceId}] Directory created: ${mountDir}`);
        }catch(mkdirError) {
          this.logger.error(`[${traceId}] Error creating directory------?: ${mkdirError.message}`);
          return {
            traceId,
            status: 'error',
            protocolType: ProtocolTypes.NFS,
            hostname: payload.hostname,
            workerId: this.workerId,
            message: `[${traceId}] Error creating directory: ${mkdirError.message}`,
          }       
        }
      }
    }
    const mountResult = await this.executeCommand(
      traceId,
      ProtocolTypes.NFS,
      payload,
      this.getCommandPattern(CommandPattern.MOUNT_PATH),
      'NFS Mount',
    );
    await new Promise((resolve) => setTimeout(resolve, 5000));
    this.logger.log(`[${traceId}] Mount result: ${JSON.stringify(mountResult)}`);  
    return mountResult;
  }
  disconnectSession(traceId: string, payload: ProtocolPayload): Promise<any> {
    throw new Error('Method not implemented.');
  }
}
