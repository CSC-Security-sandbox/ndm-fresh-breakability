import { CommandConfig, CommandPattern } from 'src/config/command.config';
import { ProtocolTypes } from 'src/protocols/protocols';
import { Protocol } from '../protocol/protocol';
import { CommandOutput, ProtocolPayload } from '../protocol/protocol.type';
import { handleConnectionError, parseLinMacShares, parseProtocolVersions, parseWindowsShares } from './smb.utils';
import * as fs from 'fs';


export class SMBProtocol extends Protocol {
 
  protected getCommandPattern( key : string): string {
    return CommandConfig.getSMBCommand(this.platform, key)
  }
  protected fstabPath =  CommandConfig.getFstabPath(this.platform);

  // --------------------------- Validate Connection -------------------------- //
  async validateConnection(traceId: string, payload: ProtocolPayload): Promise<any> {
    await this.listPaths(traceId, payload)
  }

  // --------------------------- Get Protocol Versions -------------------------- //
  async getProtocolVersions(traceId: string, payload: ProtocolPayload): Promise<any> {
    this.logger.info(`[${traceId}] Getting protocols for ${payload.hostname} of type ${ProtocolTypes.SMB} from ${this.workerId}`,);
    return this.executeCommand(
      traceId,
      ProtocolTypes.SMB,
      payload,
      this.getCommandPattern(CommandPattern.VERSION_DETAIL),
      'SMB Get Protocol Versions',
    ).then((response) => {
      this.logger.info(`[${traceId}] ${response.message}`);
      return parseProtocolVersions(response.message);
    });    
  }

  // --------------------------- List Paths MAC and LINUX-------------------------- //
  async listPathLinMac (traceId: string, payload: ProtocolPayload): Promise<any> {
    try {
      const response:CommandOutput = await this.executeCommand(
        traceId,
        ProtocolTypes.SMB,
        payload,
        this.getCommandPattern(CommandPattern.LIST_PATHS),
        'SMB Show Shares',
      )
      this.logger.info(`[${traceId}] ${response.message} ${response.status}`);
      return parseLinMacShares(response.message);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Error during SMB connection: ${errorMessage}`);
        const match = errorMessage.match(/NT_STATUS_[A-Z_]+/);
        const errorCode = match ? match[0] : errorMessage;
        throw new Error(handleConnectionError(errorCode));
    }
  }


  // --------------------------- List Paths WINDOWS -------------------------- //
  async listPathWindows (traceId: string, payload: ProtocolPayload) {
    try {
      const result = await this.executeCommand(
        traceId,
        ProtocolTypes.SMB,
        payload,
        this.getCommandPattern(CommandPattern.VALIDATE_CRED),
        'Connect SMB via Cred',
      )
      this.logger.log(JSON.stringify(result))
      if(result?.message?.toLowerCase().includes("successfully.")){
        const response = await this.executeCommand(
          traceId,
          ProtocolTypes.SMB,
          payload,
          this.getCommandPattern(CommandPattern.LIST_PATHS),
          'SMB Show Shares',
        );

        this.logger.info(`[${traceId}] ${response.message}`);
        return parseWindowsShares(response.message);
      }
    }
    catch(e) {
        this.logger.log(`error: ${e}`)
        const lines = e.message.split('\n'); 
        throw new Error(lines.length > 1 ? lines.slice(1).join('\n') : '')
    }
  }

  // --------------------------- List Paths -------------------------- //
  async listPaths(traceId: string, payload: ProtocolPayload): Promise<any> {
    this.logger.info(`[${traceId}] Getting list paths for ${payload.hostname} of type ${ProtocolTypes.SMB} from ${this.workerId}, platform: ${this.platform}`);
    switch(this.platform){
      case 'darwin':
        return await this.listPathLinMac(traceId, payload)
      case 'linux':
        return await this.listPathLinMac(traceId, payload)
      case 'win32':
        return await this.listPathWindows(traceId, payload)
      default :
        throw Error(`Unsupported platform ${this.platform}`)
    }
  }

  // --------------------------- Get total size of a mounted path -------------------------- //
  async getTotalUsedMemory(traceId: string, payload: ProtocolPayload): Promise<number> {
    this.logger.debug("inside getTotalUsedMemory method for windows");
    try {
      return this.executeCommand(
        traceId,
        ProtocolTypes.SMB,
        payload,
        this.getCommandPattern(CommandPattern.MOUNTED_FOLDER_SIZE),
        'SMB Mounted Folder size',
      ).then((response) => {
        this.logger.log(`response of executeCommand in getTotalUsedMemory - ${JSON.stringify(response)}`);
        this.logger.info(`[${traceId}] ${response.message}`);
        return parseInt(response.message.trim()) || 0;
      });
    } catch (error) {
      this.logger.error(`[${traceId}] Error checking total data size : ${error.message}`);
      throw new Error(`Failed to calculate size: ${error.message}`);
    }
  }

   // --------------------------- Available Disc Space -------------------------- //
    async getAvailableDiskSpace(traceId: string, payload: ProtocolPayload): Promise<{ size: number }> {
      this.logger.debug("inside getAvailableDiskSpace method for windows");
      try {
        this.logger.log(`[${traceId}] Checking available disk space at path: ${payload?.path}`);
        return this.executeCommand(
          traceId,
          ProtocolTypes.NFS,
          payload,
          this.getCommandPattern(CommandPattern.AVAILABLE_DISK_SPACE),
          'SMB Available Disk Space',
        ).then((response) => {
          this.logger.log(`response of getAvailableDiskSpace in smb.protocol ${JSON.stringify(response)}`);
          this.logger.info(`[${traceId}] ${response.message}`);
          const available = parseInt(response.message.trim(), 10);
          this.logger.log(`[${traceId}] Available space at ${payload?.path}: ${available} bytes`);
          return { size: available };
        });
       
      } catch (error) {
        this.logger.error(`[${traceId}] Error checking disk space for path ${payload?.path}: ${error.message}`);
        throw new Error(`Failed to get available disk space at ${payload?.path}`);
      }
    }


    async unmountPath(traceId: string, payload: any): Promise<any> {
      this.logger.info(
        `[${traceId}] Unmounting path for ${payload.hostname} of type ${ProtocolTypes.SMB} from ${this.workerId}`,
      );
    
      const response = await this.executeCommand(
        traceId,
        ProtocolTypes.SMB,
        payload,
        this.getCommandPattern(CommandPattern.UNMOUNT_PATH),
        'SMB Unmount',
      );
    
      if (response?.message?.toLowerCase().includes('successfully.')) {
        const unlinkResponse = await this.executeCommand(
          traceId,
          ProtocolTypes.SMB,
          payload,
          this.getCommandPattern(CommandPattern.UNLINK_PATH),
          'SMB Show Shares',
        );
        this.logger.info(`[${traceId}] ${unlinkResponse.message}`);
    
        // Remove the corresponding entry from /etc/fstab
        try {
          const mountDir = `${payload.mountBasePath}/${payload.jobRunId}`;
          const fstabEntry = `//${payload.hostname}/${payload.path} ${mountDir} cifs username=${payload.username},password=${payload.password},iocharset=utf8,sec=ntlm 0 0\n`;
    
          if (fs.existsSync(this.fstabPath)) {
            const fstabContent = fs.readFileSync(this.fstabPath, 'utf-8');
            const updatedFstabContent = fstabContent
              .split('\n')
              .filter((line) => line.trim() !== fstabEntry.trim())
              .join('\n');
    
            fs.writeFileSync(this.fstabPath, updatedFstabContent);
            this.logger.info(`[${traceId}] Removed entry from /etc/fstab: ${fstabEntry}`);
          } else {
            this.logger.warn(`[${traceId}] /etc/fstab does not exist.`);
          }
        } catch (error) {
          this.logger.error(`[${traceId}] Error removing entry from /etc/fstab: ${error.message}`);

        }
      }
    
      return response;
    }

  async mountPath(traceId: string, payload: any): Promise<any> {
    this.logger.info(
      `[${traceId}] Mounting path for ${payload.hostname} of type ${ProtocolTypes.SMB} from ${this.workerId}`,
    );
  
    const mountDir = `${payload.mountBasePath}/${payload.jobRunId}`;
    if (!fs.existsSync(mountDir)) {
      try {
        fs.mkdirSync(mountDir, { recursive: true });
        this.logger.info(`[${traceId}] Directory created: ${mountDir}`);
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
  
    const result = await this.executeCommand(
      traceId,
      ProtocolTypes.SMB,
      payload,
      this.getCommandPattern(CommandPattern.MOUNT_PATH),
      'SMB Mount',
    );
  
    if (result?.message?.toLowerCase().includes('successfully.')) {
      // Append the mount entry to /etc/fstab
      try {
        const fstabEntry = `//${payload.hostname}/${payload.path} ${mountDir} cifs username=${payload.username},password=${payload.password},iocharset=utf8,sec=ntlm 0 0\n`;
  
        // Check if the entry already exists in /etc/fstab
        const fstabContent = fs.readFileSync(this.fstabPath, 'utf-8');
        if (!fstabContent.includes(fstabEntry)) {
          fs.appendFileSync(this.fstabPath, fstabEntry);
          this.logger.info(`[${traceId}] Added entry to /etc/fstab: ${fstabEntry}`);
        } else {
          this.logger.info(`[${traceId}] Entry already exists in /etc/fstab: ${fstabEntry}`);
        }
      } catch (error) {
        this.logger.error(`[${traceId}] Error updating /etc/fstab: ${error.message}`);
        return {
          traceId,
          status: 'error',
          protocolType: ProtocolTypes.SMB,
          hostname: payload.hostname,
          workerId: this.workerId,
          message: `[${traceId}] Error updating /etc/fstab: ${error.message}`,
        };
      }
  
      const response = await this.executeCommand(
        traceId,
        ProtocolTypes.SMB,
        payload,
        this.getCommandPattern(CommandPattern.CREATE_PATH_LINK),
        'SMB Show Shares',
      );
  
      this.logger.info(`[${traceId}] ${response.message}`);
      return response;
    }
  
    return result;
  }
  
  async disconnectSession(traceId: string, payload: ProtocolPayload): Promise<any> {
    this.logger.info(
      `[${traceId}] disconnecting session  ${payload.hostname} of type ${ProtocolTypes.SMB} from ${this.workerId}`,
    );
    const response  = await this.executeCommand(
      traceId,
      ProtocolTypes.SMB,
      payload,
      this.getCommandPattern(CommandPattern.DISCONNECT_SESSION),
      'SMB Disconnect Session',
    );
    return response;
  }

  getTotalSizeLinux(traceId: string, payload: ProtocolPayload): Promise<any> {
    throw new Error('Method not implemented.');
  }

}
