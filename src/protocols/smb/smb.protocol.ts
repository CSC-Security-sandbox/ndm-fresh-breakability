import { CommandConfig, CommandPattern } from 'src/config/command.config';
import { ProtocolTypes } from 'src/protocols/protocols';
import { Protocol } from '../protocol/protocol';
import { CommandOutput, ProtocolPayload } from '../protocol/protocol.type';
import { handleConnectionError, parseLinMacShares, parseProtocolVersions, parseWindowsShares } from './smb.utils';
// import { WorkersConfig } from 'src/config/app.config';
import * as fs from 'fs';


export class SMBProtocol extends Protocol {
  protected getCommandPattern( key : string): string {
    return CommandConfig.getSMBCommand(this.platform, key)
  }

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
      'SMB Get Protocols',
    ).then((response) => {
      this.logger.info(`[${traceId}] ${response.message}`);
      return parseProtocolVersions(response.message);
    });    
  }

  // --------------------------- List Paths MAC and LINUX-------------------------- //
  async listPathLinMac (traceId: string, payload: ProtocolPayload) {
    this.logger.info( `[${traceId}] Getting list paths for ${payload.hostname} of type ${ProtocolTypes.SMB} from ${this.workerId}`);
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
    this.logger.info( `[${traceId}] Getting list paths for ${payload.hostname} of type ${ProtocolTypes.SMB} from ${this.workerId}`);
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
    this.logger.log(`platform: ${this.platform}`)
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

    if(response?.message?.toLowerCase().includes("successfully.")){
      const response = await this.executeCommand(
        traceId,
        ProtocolTypes.SMB,
        payload,
        this.getCommandPattern(CommandPattern.UNLINK_PATH),
        'SMB Show Shares',
      );
      this.logger.info(`[${traceId}] ${response.message}`);
    }

    // if (response['status'] === 'success') {
    //   const mountDir = `${this.baseMountDir}/${payload.jobRunId}`;
    //   if (fs.existsSync(mountDir)) {
    //     fs.rmdirSync(mountDir, { recursive: false });
    //     this.logger.info(`[${traceId}] Directory removed: ${mountDir}`);
    //   } else {
    //     this.logger.info(`[${traceId}] Directory does not exist: ${mountDir}`);
    //   }
      return response;
    // }
  }

  async mountPath(traceId: string, payload: any): Promise<any> {
    this.logger.info(
      `[${traceId}] Mounting path for ${payload.hostname} of type ${ProtocolTypes.SMB} from ${this.workerId}`,
    );

    const mountDir = `${payload.mountBasePath}/${payload.jobRunId}`;
    if (!fs.existsSync(mountDir)) {
      try{
        fs.mkdirSync(mountDir,{ recursive: true });
        this.logger.info(`[${traceId}] Directory created: ${mountDir}`);
        } catch (error) {
          this.logger.error(`[${traceId}] Error creating directory------?: ${error.message}`);
          return {
            traceId,
            status: 'error',
            protocolType: ProtocolTypes.NFS,
            hostname: payload.hostname,
            workerId: this.workerId,
            message: `[${traceId}] Error creating directory: ${error.message}`,
          }
      }
    }

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

      this.logger.info(`[${traceId}] ${response.message}`);
      return response;
    }

  }

}
