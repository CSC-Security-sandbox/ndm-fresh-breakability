import { CommandConfig, CommandPattern } from 'src/config/command.config';
import { ProtocolTypes } from 'src/protocols/protocols';
import { Protocol } from '../protocol/protocol';
import { CommandOutput, ProtocolPayload } from '../protocol/protocol.type';
import { handleConnectionError, parseLinMacShares, parseProtocolVersions, parseWindowsShares } from './smb.utils';


export class SMBProtocol extends Protocol {

  protected getCommandPattern( key : string): string {
    return CommandConfig.getSMBCommand(this.platform, key)
  }

  // --------------------------- Validate Connection -------------------------- //
  async validateConnection(traceId: string, payload: ProtocolPayload): Promise<any> {
    return
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
      if(result?.toLowerCase().includes("successfully.")){
        this.executeCommand(
          traceId,
          ProtocolTypes.SMB,
          payload,
          this.getCommandPattern(CommandPattern.LIST_PATHS),
          'SMB Show Shares',
        ).then((response) => {
          this.logger.info(`[${traceId}] ${response.message}`);
          return parseWindowsShares(response.message);
        })
      }
    }
    catch(e) {
        const lines = e.message.split('\n'); 
        throw new Error(lines.length > 1 ? lines.slice(1).join('\n') : '')
    }
  }

  // --------------------------- List Paths -------------------------- //
  async listPaths(traceId: string, payload: ProtocolPayload): Promise<any> {
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

}
