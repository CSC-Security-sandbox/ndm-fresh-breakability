

import { CommandConfig } from 'src/config/command.config';
import { ProtocolTypes } from '../protocols';
import { Protocol } from './protocol';

export class NFSProtocol extends Protocol {

  protected getCommandPattern( key : string): string {
    return CommandConfig.getNFSCommand(this.platform, key)
  }

  async parseProtocolVersions(output: string): Promise<string[]> {
    if (!output) {
      return [];
    }

    const lines = output.split('\n');
    const protocols = lines
      .filter((line) => line.endsWith('nfs'))
      .map((line) => line.split(' '))
      .map((tokens) => tokens.filter((token) => token.trim() !== ''))
      .map((tokens) => tokens[1]);

    return protocols;
  }

  async getProtocolVersions(traceId: string, payload: any): Promise<any> {
    this.logger.info(
      `[${traceId}] Getting protocols for ${payload.hostname} of type ${ProtocolTypes.NFS} from ${this.workerId}`,
    );

    return this.executeCommand(
      traceId,
      ProtocolTypes.NFS,
      payload,
      this.getCommandPattern('versionDetails'),
      'NFS Get Protocols',
    ).then((response) => {
      this.logger.info(`[${traceId}] ${response.message}`);
      return this.parseProtocolVersions(response.message);
    });
  }

  async parseExports(output: string): Promise<string[]> {
    if (!output) {
      return [];
    }
    const lines = output.split('\n');
    const exports = lines
      .filter((line) => line.startsWith('/'))
      .map((line) => line.split(' ')[0]);

    return exports;
  }

  async listPaths(traceId: string, payload: any): Promise<any> {
    this.logger.info(
      `[${traceId}] Getting list paths for ${payload.hostname} of type ${ProtocolTypes.NFS} from ${this.workerId}`,
    );

    return this.executeCommand(
      traceId,
      ProtocolTypes.NFS,
      payload,
      this.getCommandPattern('listPath'),
      'NFS Show Mount',
    ).then((response) => {
      this.logger.info(`[${traceId}] ${response.message}`);
      return this.parseExports(response.message);
    });
  }
}
