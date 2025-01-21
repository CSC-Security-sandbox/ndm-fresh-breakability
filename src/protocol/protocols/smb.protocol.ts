
import { CommandConfig } from 'src/config/command.config';
import { ProtocolTypes } from '../protocols';
import { Protocol } from './protocol';

export class SMBProtocol extends Protocol {

  protected getCommandPattern( key : string): string {
    const ans  =  CommandConfig.getSMBCommand(this.platform, key)
    this.logger.info(`Command pattern for ${key} is ${ans}`)
    return ans
  }

  async parseProtocolVersions(output: string): Promise<string[]> {
    if (!output) {
      return [];
    }

    const dialects = this.parseDialects(output);
    return [...dialects];
  }

  parseDialects(output: string): string[] {
    const dialects: string[] = [];
    const dialectsSection = output.split('| smb-protocols:')[1];
    if (dialectsSection) {
      const dialectLines = dialectsSection.split('\n').filter(line => line.trim().startsWith('|     ') || line.trim().startsWith('|_ '));
      dialectLines.forEach(line => {
        const dialect = line.split(/(?:\| {5}|\|_ {4})/)[1].trim();
        if (dialect) {
          dialects.push(dialect.replace(/:/g, '.').trim());
        }
      });
    }
    return dialects;
  }

  async getProtocolVersions(traceId: string, payload: any): Promise<any> {
    this.logger.info(
      `[${traceId}] Getting protocols for ${payload.hostname} of type ${ProtocolTypes.SMB} from ${this.workerId}`,
    );

    return this.executeCommand(
      traceId,
      ProtocolTypes.SMB,
      payload,
      this.getCommandPattern('versionDetails'),
      'SMB Get Protocols',
    ).then((response) => {
      this.logger.info(`[${traceId}] ${response.message}`);
      return this.parseProtocolVersions(response.message);
    });    
  }

  async parseShares(output: string): Promise<string[]> {
    if (!output) {
      return [];
    }
    const lines = output.split('\n');
    const shares = lines
      .filter((line) => !line.startsWith('Share') && !line.startsWith('---') && line.trim() && !line.includes('shares listed'))
      .map((line) => line.split(' ')[0].trim())
      .filter((share) => !share.endsWith('$'));
    return shares;
  }

  async listPaths(traceId: string, payload: any): Promise<any> {
    this.logger.info(
      `[${traceId}] Getting list paths for ${payload.hostname} of type ${ProtocolTypes.SMB} from ${this.workerId}`,
    );

    return this.executeCommand(
      traceId,
      ProtocolTypes.SMB,
      payload,
      this.getCommandPattern('listPath'),
      'SMB Show Shares',
    ).then((response) => {
      this.logger.info(`[${traceId}] ${response.message}`);
      return this.parseShares(response.message);
    });
  }
}
