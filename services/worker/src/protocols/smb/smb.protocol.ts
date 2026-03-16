import { CommandConfig, CommandPattern } from 'src/config/command.config';
import { ProtocolTypes } from 'src/protocols/protocols';
import { Protocol } from '../protocol/protocol';
import { CommandOutput, ProtocolPayload } from '../protocol/protocol.type';
import { handleConnectionError, parseLinMacShares, parseProtocolVersions, parseWindowsShares } from './smb.utils';
import * as fs from 'fs';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { isPathExists } from 'src/activities/core/utils/utils';
import { WindowsPrivilegeService } from './windows-privilege.service';

@Injectable()
export class SMBProtocol extends Protocol {
  @Optional()
  @Inject(WindowsPrivilegeService)
  private readonly windowsPrivilegeService?: WindowsPrivilegeService;

  protected getCommandPattern( key : string): string {
    return CommandConfig.getSMBCommand(this.platform, key)
  }

  constructor(
    private readonly loggerFactory: LoggerFactory
  ) {
    super(loggerFactory); // Pass to abstract class protocol
  }

  // --------------------------- Validate Connection -------------------------- //
  async validateConnection(traceId: string, payload: ProtocolPayload): Promise<{ warnings: string[] }> {
    const warnings: string[] = [];

    if (this.platform === 'win32' && this.windowsPrivilegeService) {
        this.logger.log(`[${traceId}] Checking Backup Operators group membership for user: ${payload.username}`);
        const checkCommand = this.getCommandPattern(CommandPattern.CHECK_BACKUP_OPERATORS);
        const result = await this.windowsPrivilegeService.checkBackupOperatorMembership(
            traceId, checkCommand, payload.username
        );

        if (result === 'SKIPPED') {
            warnings.push('BACKUP_OPERATORS_CHECK_SKIPPED');
        } else if (result === 'NOT_MEMBER') {
            warnings.push('BACKUP_OPERATORS_NOT_MEMBER');
        }
    }

    await this.listPaths(traceId, payload);
    return { warnings };
  }

  // --------------------------- Get Protocol Versions -------------------------- //
  async getProtocolVersions(traceId: string, payload: ProtocolPayload): Promise<any> {
    this.logger.log(`[${traceId}] Getting protocols for ${payload.hostname} of type ${ProtocolTypes.SMB} from ${this.workerId}`,);
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
      this.logger.log(`[${traceId}] ${response.message} ${response.status}`);
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

        this.logger.log(`[${traceId}] ${response.message}`);
        return parseWindowsShares(response.message);
      }else{
        throw new Error(`Mount operation failed: ${result.message}`);
      }
    }
    catch(e) {
      this.logger.log(`error: ${e}`)
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`error: ${message}`);
      const lines = message.split('\n');
      const cleanedMessage = lines.length > 1 ? lines.slice(1).join('\n') : message;
      throw new Error(cleanedMessage);
 
    }
  }

  // --------------------------- List Paths -------------------------- //
  async listPaths(traceId: string, payload: ProtocolPayload): Promise<any> {
    this.logger.log(`[${traceId}] Getting list paths for ${payload.hostname} of type ${ProtocolTypes.SMB} from ${this.workerId}, platform: ${this.platform}`);
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
    try {
      const response   = await this.executeCommand(traceId,
        ProtocolTypes.SMB, payload,
        this.getCommandPattern(CommandPattern.MOUNTED_FOLDER_SIZE),
        'SMB Mounted Folder size',
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
          'SMB Available Disk Space',
        );
        if(response.status = "success"){
          this.logger.log(`response of getAvailableDiskSpace in smb.protocol ${JSON.stringify(response)}`);
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


  async unmountPath(traceId: string, payload: ProtocolPayload): Promise<any> {
    this.logger.log(
      `[${traceId}] Unmounting path for ${payload.hostname} of type ${ProtocolTypes.SMB} from ${this.workerId}`,
    );
    try{
       const response = await this.executeCommand(
      traceId,
      ProtocolTypes.SMB,
      payload,
      this.getCommandPattern(CommandPattern.UNMOUNT_PATH),
      'SMB Unmount',
    );

    if(response?.message?.toLowerCase().includes("successfully.")){
      const response = await this.executeCommand(
        traceId,
        ProtocolTypes.SMB,
        payload,
        this.getCommandPattern(CommandPattern.UNLINK_PATH),
        'SMB Show Shares',
      );
      this.logger.log(`[${traceId}] ${response.message}`);
    }
    return response;

    }catch(error){
      this.logger.log(
          `[${traceId}] Error Unmounting path for ${payload.hostname} of type ${ProtocolTypes.SMB} from ${this.workerId}: ${error.message}`,
      )
      throw error;
    }
   
  }

  async mountPath(traceId: string, payload: ProtocolPayload, manageMount: boolean = false): Promise<any> {
    this.logger.log(
      `[${traceId}] Mounting path for ${payload.hostname} of type ${ProtocolTypes.SMB} from ${this.workerId}`,
    );

    // Enable Windows backup privileges for SMB on Windows platform
    if (this.platform === 'win32' && this.windowsPrivilegeService && manageMount) {
      try {
        this.logger.log(`[${traceId}] Enabling Windows backup privileges for SMB access`);
        await this.windowsPrivilegeService.enableBackupPrivileges(payload.jobRunId);
        this.logger.log(`[${traceId}] Backup privileges enabled successfully for SMB`);
      } catch (error) {
        this.logger.error(`[${traceId}] Failed to enable Windows backup privileges: ${error.message}`);
        throw new Error(`Failed to enable Windows backup privileges required for SMB operations: ${error.message}`);
      }
    }

    const mountDir = `${payload.mountBasePath}/${payload.jobRunId}`;
    const mountDirExists = await isPathExists(mountDir);
    if (!mountDirExists) {
      try {
        await fs.promises.mkdir(mountDir, { recursive: true });
        this.logger.log(`[${traceId}] Directory created: ${mountDir}`);
        } catch (error) {
          this.logger.error(`[${traceId}] Error creating directory------?: ${error.message}`);
          return {
            traceId,
            status: 'error',
            protocolType: ProtocolTypes.SMB,
            hostname: payload.hostname,
            workerId: this.workerId,
            message: `[${traceId}] Error creating directory: ${error.message}`,
          }
      }
    }
    try{

      const saveCredsResult = await this.executeCommand(
        traceId,
        ProtocolTypes.SMB,
        payload,
        this.getCommandPattern(CommandPattern.SAVE_CREDS),
        'SMB Save Credentials',
      );
      
      if(!saveCredsResult?.message?.toLowerCase().includes("successfully."))
        throw new Error(`Save credentials operation failed: ${saveCredsResult.message}`);

      const result = await this.executeCommand(
        traceId,
        ProtocolTypes.SMB,
        payload,
        this.getCommandPattern(CommandPattern.MOUNT_PATH),
        'SMB Mount',
      );
      
      if(result?.message?.toLowerCase().includes("successfully.")){
        const response = await this.executeCommand(
          traceId,
          ProtocolTypes.SMB,
          payload,
          this.getCommandPattern(CommandPattern.CREATE_PATH_LINK),
          'SMB Show Shares',
        );

        this.logger.log(`[${traceId}] ${response.message}`);
        return response;
      }
    }catch(error){
      this.logger.error(`[${traceId}] Error mounting path for ${payload.hostname} of type ${ProtocolTypes.SMB} from ${this.workerId}: ${error.message}`);
      throw new Error(`Failed to mount path at ${payload.hostname}, reason: ${error.message}`);
    }
  }
  
  async disconnectSession(traceId: string, payload: ProtocolPayload): Promise<any> {
    this.logger.log(
      `[${traceId}] disconnecting session  ${payload.hostname} of type ${ProtocolTypes.SMB} from ${this.workerId}`,
    );
    try{
        const response  = await this.executeCommand(
          traceId,
          ProtocolTypes.SMB,
          payload,
          this.getCommandPattern(CommandPattern.DISCONNECT_SESSION),
          'SMB Disconnect Session',
        );
      return response;
    }catch(error){
      this.logger.log(
          `[${traceId}] error disconnecting session  ${payload.hostname} of type ${ProtocolTypes.SMB} from ${this.workerId}: ${error.message}`,
      )
      throw error;
    }
    
  }

  getTotalSizeLinux(traceId: string, payload: ProtocolPayload): Promise<any> {
    throw new Error('Method not implemented.');
  }

  updateBootMounts({ platform, fstabPath, workerId }: { platform: any; fstabPath: any; workerId: any; }, payload: any, action: any, traceId: any): void {
    this.logger.log(`[${traceId}] updateBootMount not implemented for SMB protocol`);
    throw new Error('Method not implemented.');
  }

}
