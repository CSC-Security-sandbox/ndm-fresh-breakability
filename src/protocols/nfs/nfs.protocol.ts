

import { CommandConfig, CommandPattern } from 'src/config/command.config';
import { Protocol } from 'src/protocols/protocol/protocol';
import { handleConnectionError, parseExports, parseProtocolVersions } from './nfs.utils';
import * as net from 'net';
import { ProtocolTypes } from 'src/protocols/protocols';
import { ProtocolPayload } from 'src/protocols/protocol/protocol.type';

export class NFSProtocol extends Protocol {

  protected getCommandPattern( key : string): string {
    return CommandConfig.getNFSCommand(this.platform, key)
  }

  // --------------------------- Validate Connection -------------------------- //
  async validateConnection(traceId:string, options: ProtocolPayload ): Promise<any> {
    const client = new net.Socket();
    try {

        this.logger.info(`[${traceId}] Attempting to connect... Protocol: ${ProtocolTypes.NFS}`);
        await new Promise<void>((resolve, reject) => {
            client.connect(2049, options.hostname, resolve);
            client.on('error', reject);
        });
        this.logger.info(`[${traceId}] Connection established for Protocol: ${ProtocolTypes.NFS}`);
        client.end();
        return 'Connection established';
    } catch (error) {
        this.logger.error(`Error during connection: ${error.message}`);
        throw new Error(handleConnectionError(error, options.hostname, 2049));
    } finally {
        client.destroy();
    }
  }

  // --------------------------- Get Protocol Versions -------------------------- //
  async getProtocolVersions(traceId: string, payload: ProtocolPayload): Promise<string[]> {
    this.logger.info(
      `[${traceId}] Getting protocols for ${payload.hostname} of type ${ProtocolTypes.NFS} from ${this.workerId}`,
    );
    return this.executeCommand(
      traceId,
      ProtocolTypes.NFS,
      payload,
      this.getCommandPattern(CommandPattern.VERSION_DETAIL),
      'NFS Get Protocols',
    ).then((response) => {
      this.logger.info(`[${traceId}] ${response.message}`);
      return parseProtocolVersions(response.message);
    });
  }


  // --------------------------- List Paths -------------------------- //
  async listPaths(traceId: string, payload: ProtocolPayload): Promise<string[]> {
    this.logger.info(
      `[${traceId}] Getting list paths for ${payload.hostname} of type ${ProtocolTypes.NFS} from ${this.workerId}`,
    );
    return this.executeCommand(
      traceId,
      ProtocolTypes.NFS,
      payload,
      this.getCommandPattern(CommandPattern.LIST_PATHS),
      'NFS Show Mount',
    ).then((response) => {
      this.logger.info(`[${traceId}] ${response.message}`);
      return parseExports(response.message);
    });
  }
  
}
